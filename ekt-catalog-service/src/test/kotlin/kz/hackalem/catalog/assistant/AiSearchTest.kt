package kz.hackalem.catalog.assistant

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import java.math.BigDecimal
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kz.hackalem.catalog.catalogModule
import kz.hackalem.catalog.ekt.NormalizedCatalog
import kz.hackalem.catalog.model.*
import kz.hackalem.catalog.prevalidation.*
import kz.hackalem.catalog.service.*
import kotlin.test.*

class AiSearchTest {
    private val source = Product("1", "SKU-A", "Test lamp 30W", Price(BigDecimal("100.50")), emptyList(), null)
    private val candidate = Product("2", "SKU-B", "Test lamp 20W", Price(BigDecimal("90")), emptyList(), null)
    private val metadata = CatalogMetadata(SourceMode.SNAPSHOT, 1, 2, null, Instant.EPOCH, null)
    private fun catalog() = CatalogService(NormalizedCatalog { CatalogSnapshot(listOf(source, candidate), metadata) })
    private fun intent(purpose: String = "analogs", sku: String? = "SKU-A", terms: List<String> = emptyList(), requirements: List<String> = emptyList(), clarification: String? = null) = buildJsonObject {
        put("purpose", purpose); put("productId", JsonNull); put("sku", sku?.let(::JsonPrimitive) ?: JsonNull)
        put("terms", JsonArray(terms.map(::JsonPrimitive))); put("requirements", JsonArray(requirements.map(::JsonPrimitive)))
        put("clarification", clarification?.let(::JsonPrimitive) ?: JsonNull)
    }.toString()
    private fun selection(id: String = "2", evidence: String = "Test lamp", extra: Boolean = false) = buildJsonObject {
        put("candidates", buildJsonArray { add(buildJsonObject {
            put("id", id); put("reason", "Похожее название; характеристики требуют проверки")
            put("nameEvidence", evidence); if (extra) put("price", 0)
        }) })
    }.toString()
    private fun agent(first: String = intent(), second: String = selection()) = StructuredAi { name, _, _, _ -> if (name == "catalog_search_intent") first else second }

    @Test fun `HTTP chain returns catalog facts with unverified candidate labels`() = testApplication {
        val catalog = catalog()
        var calls = 0
        val ai = StructuredAi { name, schema, _, input ->
            calls++
            assertEquals(JsonPrimitive(false), schema["additionalProperties"])
            if (name == "catalog_search_intent") {
                assertEquals(setOf("text"), input.keys)
                intent(requirements = listOf("дешевле"))
            } else {
                val products = input.getValue("products").jsonArray
                assertEquals(listOf("2"), products.map { it.jsonObject.getValue("id").jsonPrimitive.content })
                assertFalse(input.toString().contains("100.50"))
                selection()
            }
        }
        application { catalogModule(catalog, AiSearchService(catalog, ai)) }
        val response = client.post("/api/catalog/assist/search") { contentType(ContentType.Application.Json); setBody("""{"text":"Нужен аналог SKU-A дешевле"}""") }
        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(2, calls)
        val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
        assertEquals(JsonPrimitive("CANDIDATES_FOUND"), body["status"])
        assertEquals(JsonPrimitive(false), body["verifiedAnalogs"])
        val row = body.getValue("candidates").jsonArray.single().jsonObject
        assertEquals(JsonPrimitive("UNVERIFIED"), row["compatibility"])
        assertEquals(JsonPrimitive(false), row["requirementsVerified"])
        val product = row.getValue("product").jsonObject
        assertEquals(JsonPrimitive("90"), product.getValue("price").jsonObject["amount"])
        assertEquals(JsonPrimitive("UNKNOWN"), product.getValue("availability").jsonObject["status"])
        assertEquals(JsonPrimitive("PARTIAL"), body.getValue("metadata").jsonObject["coverage"])
    }

    @Test fun `clarification and unknown identity do not trigger ranking`() = runBlocking {
        var calls = 0
        val clarification = AiSearchService(CatalogService(), StructuredAi { _, _, _, _ -> calls++; intent("clarification", null, clarification = "Какой товар нужен?") })
        assertEquals("CLARIFICATION_REQUIRED", clarification.search("Помогите").status)
        assertEquals(1, calls)
        val missing = AiSearchService(catalog(), StructuredAi { _, _, _, _ -> calls++; intent(sku = "MISSING") })
        assertEquals("SOURCE_NOT_IN_LOADED_SAMPLE", missing.search("Аналог MISSING").status)
        assertEquals(2, calls)
    }

    @Test fun `fabricated identifiers facts evidence and source-as-analog are rejected`() = runBlocking {
        for (selected in listOf(selection("999"), selection("1"), selection(evidence = "Available 100 units"), selection(extra = true))) {
            val error = assertFailsWith<CatalogException> { AiSearchService(catalog(), agent(second = selected)).search("Аналог SKU-A") }
            assertEquals(CatalogError.AI_INVALID_RESPONSE, error.error)
        }
    }

    @Test fun `extracted filters must be grounded in original input`() = runBlocking {
        for (first in listOf(intent(sku = "INVENTED"), intent(terms = listOf("invented brand")), intent(requirements = listOf("220 V")), "{}")) {
            val error = assertFailsWith<CatalogException> { AiSearchService(catalog(), agent(first = first)).search("Аналог SKU-A") }
            assertEquals(CatalogError.AI_INVALID_RESPONSE, error.error)
        }
    }

    @Test fun `returned price is reread from catalog after model response`() = runBlocking {
        var reads = 0
        val catalog = CatalogService(NormalizedCatalog {
            reads++
            CatalogSnapshot(listOf(source, candidate.copy(price = Price(BigDecimal(if (reads == 1) "90" else "120")))), metadata)
        })
        val result = AiSearchService(catalog, agent()).search("Аналог SKU-A")
        assertEquals(2, reads)
        assertEquals(BigDecimal("120"), result.candidates.single().product.price!!.amount)
    }

    @Test fun `candidate disappearance during model request cannot return stale product`() = runBlocking {
        var reads = 0
        val catalog = CatalogService(NormalizedCatalog { reads++; CatalogSnapshot(if (reads == 1) listOf(source, candidate) else listOf(source), metadata) })
        val failure = assertFailsWith<CatalogException> { AiSearchService(catalog, agent()).search("Аналог SKU-A") }
        assertEquals(CatalogError.AI_INVALID_RESPONSE, failure.error)
    }

    @Test fun `AI failures remain failures not empty successful searches`() = runBlocking {
        for ((failure, expected) in listOf(FailureCategory.timeout to CatalogError.AI_UNAVAILABLE, FailureCategory.refusal to CatalogError.AI_INVALID_RESPONSE, FailureCategory.invalid_response to CatalogError.AI_INVALID_RESPONSE)) {
            val error = assertFailsWith<CatalogException> { AiSearchService(catalog(), StructuredAi { _, _, _, _ -> fail(failure) }).search("SKU-A") }
            assertEquals(expected, error.error)
        }
        val disabled = assertFailsWith<CatalogException> { AiSearchService.fromEnvironment(catalog(), emptyMap()).search("SKU-A") }
        assertEquals(CatalogError.AI_DISABLED, disabled.error)
    }

    @Test fun `request body is bounded strict and secrets never appear in errors`() = testApplication {
        val catalog = catalog()
        application { catalogModule(catalog, AiSearchService(catalog, StructuredAi { _, _, _, _ -> error("private-provider-key") })) }
        for (body in listOf("{}", "not-json", """{"text":5}""", """{"text":""}""", """{"text":"SKU-A","extra":true}""")) {
            assertEquals(HttpStatusCode.BadRequest, client.post("/api/catalog/assist/search") { contentType(ContentType.Application.Json); setBody(body) }.status)
        }
        val large = client.post("/api/catalog/assist/search") { contentType(ContentType.Application.Json); setBody("a".repeat(8193)) }
        assertEquals(HttpStatusCode.PayloadTooLarge, large.status)
        val error = client.post("/api/catalog/assist/search") { contentType(ContentType.Application.Json); setBody("""{"text":"SKU-A"}""") }
        assertEquals(HttpStatusCode.ServiceUnavailable, error.status)
        assertFalse(error.bodyAsText().contains("private-provider-key"))
    }

    @Test fun `empty AI selection remains scoped to partial candidate pool`() = runBlocking {
        val result = AiSearchService(catalog(), agent(second = """{"candidates":[]}""")).search("Аналог SKU-A")
        assertEquals("NO_CANDIDATES_IN_LOADED_SAMPLE", result.status)
        assertTrue(result.candidates.isEmpty())
        assertEquals(1, result.consideredProducts)
    }
}
