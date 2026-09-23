package kz.hackalem.catalog

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.testing.*
import java.math.BigDecimal
import java.time.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kz.hackalem.catalog.ekt.*
import kz.hackalem.catalog.model.*
import kz.hackalem.catalog.normalization.EktListNormalizer
import kz.hackalem.catalog.service.*
import kotlin.test.*

class CatalogDataTest {
    private val fixture = javaClass.getResource("/ekt/products-page-1.json")!!
    private fun raw() = Json.parseToJsonElement(fixture.readText()).jsonObject
    private fun products() = EktListNormalizer.normalize(raw(), 100)
    private fun source() = CatalogSources.fromEnvironment(mapOf("CATALOG_SOURCE" to "snapshot", "CATALOG_SNAPSHOT_PATH" to java.nio.file.Path.of(fixture.toURI()).toString()))!!

    @Test fun `observed EKT list maps identity decimals and unknown stock without guessing`() {
        val products = products()
        assertEquals(20, products.size)
        val first = products.first()
        assertEquals("45357", first.id)
        assertEquals("ярп4520", first.sku)
        assertEquals(BigDecimal("1810"), first.price!!.amount)
        assertNull(first.price.currency)
        assertEquals("310100080_", products.first { it.id == "25397" }.sku)
        assertTrue(products.first { it.id == "25397" }.images.isEmpty())
        assertTrue(products.all { it.availability == Availability(AvailabilityStatus.UNKNOWN, null) })
    }

    @Test fun `missing price is distinct from zero and decimals retain precision`() {
        fun product(price: JsonElement?) = buildJsonObject { put("id", 1); put("name", "Test"); if (price != null) put("price", price); put("offers", buildJsonArray { add(buildJsonObject { put("quantity", 999) }) }) }
        for ((price, expected) in listOf(null to null, JsonNull to null, JsonPrimitive(0) to "0", Json.parseToJsonElement("123456789.123456789") to "123456789.123456789")) {
            val result = EktListNormalizer.normalize(page(product(price)), 100).single()
            assertEquals(expected, result.price?.amount?.toPlainString())
            assertEquals(AvailabilityStatus.UNKNOWN, result.availability.status)
        }
    }

    @Test fun `malformed records and duplicate ids are explicit errors`() {
        val good = raw().getValue("items").jsonArray.first().jsonObject
        for (bad in listOf(
            JsonObject(good + ("id" to JsonPrimitive("45357"))),
            JsonObject(good + ("price" to JsonPrimitive("1810"))),
            JsonObject(good + ("image" to JsonPrimitive("javascript:alert(1)"))),
            JsonObject(good + ("url" to JsonPrimitive("https://user:password@example.com"))),
            JsonObject(good - "name"),
        )) assertFailsWith<EktException.InvalidResponse> { EktListNormalizer.normalize(page(bad), 100) }
        assertFailsWith<EktException.InvalidResponse> { EktListNormalizer.normalize(page(good, good), 100) }
        assertEquals(3, EktListNormalizer.normalize(raw(), 3).size)
    }

    @Test fun `snapshot HTTP serves normalized facts and explicit partial unknown freshness`() = testApplication {
        application { catalogModule(CatalogService(source())) }
        val response = client.get("/api/catalog/products/45357")
        assertEquals(HttpStatusCode.OK, response.status)
        val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
        val product = body.getValue("product").jsonObject
        assertEquals(JsonPrimitive("ярп4520"), product["sku"])
        assertEquals(JsonPrimitive("1810"), product.getValue("price").jsonObject["amount"])
        for (field in listOf("offers", "url_api_detail", "article", "Authorization")) assertFalse(response.bodyAsText().contains("\"$field\""))
        val metadata = body.getValue("metadata").jsonObject
        assertEquals(JsonPrimitive("PARTIAL"), metadata["coverage"])
        assertEquals(JsonPrimitive("SNAPSHOT"), metadata["mode"])
        assertEquals(JsonPrimitive("UNKNOWN"), metadata["freshness"])
        assertEquals(JsonNull, metadata["observedAt"])
        assertEquals(JsonNull, metadata["totalProducts"])
        val availability = client.get("/api/catalog/products/45357/availability")
        assertEquals(HttpStatusCode.OK, availability.status)
        val stock = Json.parseToJsonElement(availability.bodyAsText()).jsonObject.getValue("availability").jsonObject
        assertEquals(JsonPrimitive("UNKNOWN"), stock["status"])
        assertEquals(JsonNull, stock["quantity"])
        assertEquals(HttpStatusCode.UnprocessableEntity, client.get("/api/catalog/products/45357/analogs").status)
    }

    @Test fun `search supports Cyrillic article and name with honest misses`() = testApplication {
        application { catalogModule(CatalogService(source())) }
        for ((query, id) in listOf("ЯРП4520" to "45357", "310100080_" to "25397", "STARK" to "45357")) {
            val response = client.get("/api/catalog/products") { parameter("query", query) }
            assertEquals(HttpStatusCode.OK, response.status)
            val items = Json.parseToJsonElement(response.bodyAsText()).jsonObject.getValue("items").jsonArray
            assertEquals(id, items.first().jsonObject.getValue("id").jsonPrimitive.content)
        }
        val search = client.get("/api/catalog/products?query=not-in-this-page")
        assertEquals(HttpStatusCode.OK, search.status)
        val result = Json.parseToJsonElement(search.bodyAsText()).jsonObject
        assertTrue(result.getValue("items").jsonArray.isEmpty())
        assertEquals(JsonPrimitive("PARTIAL"), result.getValue("metadata").jsonObject["coverage"])
        val missing = client.get("/api/catalog/products/999999999")
        assertEquals(HttpStatusCode.NotFound, missing.status)
        assertTrue(missing.bodyAsText().contains("PRODUCT_NOT_IN_LOADED_SAMPLE"))
    }

    @Test fun `upstream errors never become successful empty catalog or product not found`() = testApplication {
        application { catalogModule(CatalogService(NormalizedCatalog { throw EktException.NotFound() })) }
        assertEquals(HttpStatusCode.ServiceUnavailable, client.get("/api/catalog/products?query=x").status)
    }

    @Test fun `invalid upstream schema maps to bad gateway`() = testApplication {
        application { catalogModule(CatalogService(NormalizedCatalog { throw EktException.InvalidResponse() })) }
        assertEquals(HttpStatusCode.BadGateway, client.get("/api/catalog/products/45357").status)
    }

    @Test fun `cache coalesces concurrent loads and never serves expired data after failure`() = runBlocking {
        val clock = MutableClock()
        var calls = 0
        var broken = false
        val catalog = CachedEktCatalog({ calls++; if (broken) throw EktException.Unavailable(); delay(10); products() }, SourceMode.LIVE, Duration.ofSeconds(60), clock)
        coroutineScope { (1..10).map { async { catalog.snapshot() } }.awaitAll() }
        assertEquals(1, calls)
        assertEquals(clock.instant(), catalog.snapshot().metadata.observedAt)
        clock.now = clock.now.plusSeconds(61)
        broken = true
        assertFailsWith<EktException.Unavailable> { catalog.snapshot() }
        assertEquals(2, calls)
        broken = false
        assertEquals(clock.instant(), catalog.snapshot().metadata.observedAt)
        assertEquals(3, calls)
    }

    @Test fun `load deadline and disabled configuration are explicit`() = runBlocking {
        val catalog = CachedEktCatalog({ delay(1000); products() }, SourceMode.LIVE, timeoutMs = 10)
        assertFailsWith<EktException.Timeout> { catalog.snapshot() }
        assertNull(CatalogSources.fromEnvironment(emptyMap()))
        assertFailsWith<EktException.Configuration> { CatalogSources.fromEnvironment(mapOf("CATALOG_SOURCE" to "snapshot")) }
        assertFailsWith<EktException.Configuration> { CatalogSources.fromEnvironment(mapOf("CATALOG_SOURCE" to "live", "CATALOG_MAX_PRODUCTS" to "0")) }
        Unit
    }

    private fun page(vararg products: JsonObject) = buildJsonObject {
        put("page", 1); put("per_page", 20); put("count", products.size); put("items", JsonArray(products.toList()))
    }
    private class MutableClock(var now: Instant = Instant.parse("2026-09-23T00:00:00Z")) : Clock() {
        override fun instant() = now
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
    }
}
