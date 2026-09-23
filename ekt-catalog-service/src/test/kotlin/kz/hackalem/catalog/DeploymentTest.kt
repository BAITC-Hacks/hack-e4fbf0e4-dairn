package kz.hackalem.catalog

import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.server.testing.*
import kz.hackalem.catalog.ekt.NormalizedCatalog
import kz.hackalem.catalog.service.CatalogService
import kotlin.test.*

class DeploymentTest {
    @Test fun `disabled catalog is live but not ready`() = testApplication {
        application { catalogModule(service = CatalogService()) }
        assertEquals(HttpStatusCode.OK, client.get("/health/live").status)
        assertEquals(HttpStatusCode.ServiceUnavailable, client.get("/health/ready").status)
    }

    @Test fun `readiness never calls upstream and CORS admits only configured origin`() = testApplication {
        application {
            catalogModule(service = CatalogService(NormalizedCatalog { error("must not contact upstream") }),
                corsOrigins = listOf("https://chat.example.com"))
        }
        assertEquals(HttpStatusCode.OK, client.get("/health/ready").status)
        val allowed = client.get("/health/live") { header(HttpHeaders.Origin, "https://chat.example.com") }
        assertEquals("https://chat.example.com", allowed.headers[HttpHeaders.AccessControlAllowOrigin])
        assertNull(allowed.headers[HttpHeaders.AccessControlAllowCredentials])
        val denied = client.get("/health/live") { header(HttpHeaders.Origin, "https://other.example.com") }
        assertNull(denied.headers[HttpHeaders.AccessControlAllowOrigin])
        val preflight = client.options("/api/catalog/assist/search") {
            header(HttpHeaders.Origin, "https://chat.example.com")
            header(HttpHeaders.AccessControlRequestMethod, "POST")
            header(HttpHeaders.AccessControlRequestHeaders, "content-type")
        }
        assertEquals(HttpStatusCode.OK, preflight.status)
    }

    @Test fun `invalid origins fail without reflecting input`() {
        for (origin in listOf("*", "https://user:secret@example.com", "https://example.com/path", "null", "https://example.com:0")) {
            val error = assertFailsWith<IllegalArgumentException> { parseCorsOrigins(origin) }
            assertFalse(error.message.orEmpty().contains("secret"))
        }
        assertEquals(emptyList(), parseCorsOrigins(null))
        assertEquals(listOf("https://chat.example.com", "http://localhost:3000"),
            parseCorsOrigins("https://chat.example.com, http://localhost:3000"))
    }
}
