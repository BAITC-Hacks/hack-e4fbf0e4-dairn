package kz.hackalem.catalog

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import kotlinx.serialization.json.*
import kz.hackalem.catalog.routes.installCatalogErrors
import kz.hackalem.catalog.service.*
import kotlin.test.*

class CatalogApplicationTest {
    @Test fun `valid requests explicitly report missing integration`() = testApplication {
        application { catalogModule() }
        for (path in listOf("/api/catalog/products/abc-1", "/api/catalog/products?query=cable", "/api/catalog/products/abc-1/availability")) {
            val response = client.get(path)
            assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
            assertEquals("CATALOG_NOT_READY", code(response.bodyAsText()))
            assertEquals("no-store", response.headers[HttpHeaders.CacheControl])
            assertEquals(ContentType.Application.Json, response.contentType()?.withoutParameters())
        }
        val analogs = client.get("/api/catalog/products/abc-1/analogs")
        assertEquals(HttpStatusCode.NotImplemented, analogs.status)
        assertEquals("ANALOGS_NOT_IMPLEMENTED", code(analogs.bodyAsText()))
    }

    @Test fun `invalid input fails before integration`() = testApplication {
        application { catalogModule() }
        for (query in listOf("", "?query=", "?query=%20", "?query=a&query=b", "?query=" + "a".repeat(201))) {
            val response = client.get("/api/catalog/products$query")
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals("INVALID_SEARCH_QUERY", code(response.bodyAsText()))
        }
        for (suffix in listOf("", "/availability", "/analogs")) {
            val response = client.get("/api/catalog/products/%20$suffix")
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals("INVALID_PRODUCT_ID", code(response.bodyAsText()))
        }
    }

    @Test fun `unmapped routes do not return product not found`() = testApplication {
        application { catalogModule() }
        val response = client.get("/api/products/abc-1")
        assertEquals(HttpStatusCode.NotFound, response.status)
        assertEquals("ROUTE_NOT_FOUND", code(response.bodyAsText()))
    }

    @Test fun `errors have stable status and cannot disclose exception details`() = testApplication {
        application {
            installCatalogErrors()
            routing {
                get("/unexpected") { error("secret-password upstream-body Authorization: Basic abc") }
                get("/error/{code}") { throw CatalogException(CatalogError.valueOf(call.parameters["code"]!!)) }
            }
        }
        val expected = mapOf(
            CatalogError.PRODUCT_NOT_FOUND to HttpStatusCode.NotFound,
            CatalogError.UPSTREAM_UNAVAILABLE to HttpStatusCode.ServiceUnavailable,
            CatalogError.UPSTREAM_INVALID_RESPONSE to HttpStatusCode.BadGateway,
            CatalogError.ANALOGS_INSUFFICIENT_DATA to HttpStatusCode.UnprocessableEntity,
            CatalogError.ANALOGS_UNAVAILABLE to HttpStatusCode.ServiceUnavailable,
        )
        for ((error, status) in expected) {
            val response = client.get("/error/${error.name}")
            assertEquals(status, response.status)
            assertEquals(error.name, code(response.bodyAsText()))
        }
        val response = client.get("/unexpected")
        assertEquals(HttpStatusCode.InternalServerError, response.status)
        assertEquals("""{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}""", response.bodyAsText())
    }

    @Test fun `service validates opaque ids and bounded trimmed queries`() {
        assertEquals("sku:abc-01", CatalogInput.productId("sku:abc-01"))
        assertEquals("кабель", CatalogInput.searchQuery(listOf("  кабель  ")))
        for (id in listOf(null, "", "a b", "a\n", "a".repeat(257))) {
            assertEquals(CatalogError.INVALID_PRODUCT_ID, assertFailsWith<CatalogException> { CatalogInput.productId(id) }.error)
        }
        for (query in listOf(null, emptyList(), listOf("a", "b"), listOf("a\u0000b"))) {
            assertEquals(CatalogError.INVALID_SEARCH_QUERY, assertFailsWith<CatalogException> { CatalogInput.searchQuery(query) }.error)
        }
    }

    private fun code(body: String) = Json.parseToJsonElement(body).jsonObject.getValue("error").jsonObject.getValue("code").jsonPrimitive.content
}
