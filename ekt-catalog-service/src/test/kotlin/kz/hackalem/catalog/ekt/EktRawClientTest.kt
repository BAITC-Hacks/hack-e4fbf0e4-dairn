package kz.hackalem.catalog.ekt

import java.net.http.HttpRequest
import java.nio.ByteBuffer
import java.util.Base64
import java.util.concurrent.CompletionException
import java.util.concurrent.Flow
import kotlin.test.*
import kotlinx.serialization.json.Json

class EktRawClientTest {
    private val environment = mapOf(
        "EKT_API_BASE_URL" to "https://catalog.example.test",
        "EKT_API_USERNAME" to "test-user",
        "EKT_API_PASSWORD" to "test-password",
    )
    private fun config() = EktConfig.fromEnvironment(environment)
    private fun response(status: Int = 200, body: String = "{}", type: String? = "application/json") =
        TransportResponse(status, type, body.toByteArray())

    @Test fun `configuration validates presence and keeps secrets out of errors and toString`() {
        environment.keys.forEach { key ->
            val error = assertFailsWith<EktException.Configuration> { EktConfig.fromEnvironment(environment - key) }
            assertTrue(key in error.message.orEmpty())
            assertFalse("test-password" in error.stackTraceToString())
        }
        assertEquals("EktConfig([redacted])", config().toString())
        assertFailsWith<EktException.Configuration> {
            EktConfig.fromEnvironment(environment + ("EKT_API_USERNAME" to "user:extra"))
        }
    }

    @Test fun `configuration rejects insecure or ambiguous origins without disclosing them`() {
        listOf("http://example.test", "https://user:secret@example.test", "https://example.test/api",
            "https://example.test?q=secret", "https://example.test#secret", "not a URL",
            "https://example.test:99999").forEach { url ->
            val error = assertFailsWith<EktException.Configuration> {
                EktConfig.fromEnvironment(environment + ("EKT_API_BASE_URL" to url))
            }
            assertFalse("secret" in error.stackTraceToString())
        }
    }

    @Test fun `list pagination and encoded detail IDs generate only the known GET endpoints`() {
        val requests = mutableListOf<HttpRequest>()
        val client = EktRawClient(config()) { request -> requests += request; response() }
        client.listProducts()
        client.listProducts(1)
        client.listProducts(2)
        client.getProductDetails("part /&?ю")
        assertEquals(listOf("/api/products", "/api/products?page=1", "/api/products?page=2",
            "/api/products/detail?id=part+%2F%26%3F%D1%8E"), requests.map { it.uri().rawPath + (it.uri().rawQuery?.let { q -> "?$q" } ?: "") })
        requests.forEach {
            assertEquals("GET", it.method())
            assertEquals("application/json", it.headers().firstValue("Accept").get())
            val basic = it.headers().firstValue("Authorization").get().removePrefix("Basic ")
            assertEquals("test-user:test-password", String(Base64.getDecoder().decode(basic)))
            assertEquals(30, it.timeout().get().seconds)
        }
    }

    @Test fun `invalid local inputs never make network requests`() {
        val client = EktRawClient(config()) { fail("Unexpected network request") }
        listOf(0, -1).forEach { assertFailsWith<EktException.InvalidRequest> { client.listProducts(it) } }
        listOf("", " ", "a\n").forEach { assertFailsWith<EktException.InvalidRequest> { client.getProductDetails(it) } }
    }

    @Test fun `HTTP errors are explicit and do not include response data`() {
        for (status in listOf(301, 400, 401, 403, 404, 429, 500, 503)) {
            val client = EktRawClient(config()) { response(status, "test-password") }
            val error = assertFailsWith<EktException> { client.listProducts() }
            when (status) {
                401, 403 -> assertIs<EktException.Authentication>(error)
                404 -> assertIs<EktException.NotFound>(error)
                else -> assertEquals(status, assertIs<EktException.Http>(error).status)
            }
            assertFalse("test-password" in error.stackTraceToString())
        }
    }

    @Test fun `malformed non JSON and empty responses fail without echoing upstream data`() {
        listOf(response(body = "test-password"), response(body = ""), response(body = "null"),
            response(body = "true"), response(body = "123"), response(body = "\"text\""),
            response(type = "text/html"), response(type = null)).forEach { upstream ->
            val error = assertFailsWith<EktException.InvalidResponse> {
                EktRawClient(config()) { upstream }.listProducts()
            }
            assertFalse("test-password" in error.stackTraceToString())
        }
    }

    @Test fun `malformed UTF8 is rejected instead of changing catalog values`() {
        val body = byteArrayOf(123, 34, 120, 34, 58, 34, 0xC3.toByte(), 34, 125)
        assertFailsWith<EktException.InvalidResponse> {
            EktRawClient(config()) { TransportResponse(200, "application/json", body) }.listProducts()
        }
    }

    @Test fun `transport preserves JSON values without assuming EKT product fields`() {
        // Synthetic transport fixture, deliberately not presented as the EKT schema.
        val body = """{"unknown":[{"value":12.3400,"absent":null,"text":"  original  "}]}"""
        assertEquals(Json.parseToJsonElement(body), EktRawClient(config()) { response(body = body) }.listProducts())
    }

    @Test fun `transport errors propagate instead of becoming an empty catalog`() {
        assertFailsWith<EktException.Timeout> {
            EktRawClient(config()) { throw EktException.Timeout() }.listProducts()
        }
    }

    @Test fun `body subscriber cancels a response that exceeds its memory limit`() {
        var cancelled = false
        val subscriber = LimitedBodySubscriber(3)
        subscriber.onSubscribe(object : Flow.Subscription {
            override fun request(n: Long) = Unit
            override fun cancel() { cancelled = true }
        })
        subscriber.onNext(listOf(ByteBuffer.wrap(byteArrayOf(1, 2)), ByteBuffer.wrap(byteArrayOf(3, 4))))
        assertTrue(cancelled)
        val error = assertFailsWith<CompletionException> { subscriber.body.toCompletableFuture().join() }
        assertIs<ResponseTooLarge>(error.cause)
    }

    @Test fun `body subscriber accepts response exactly at the limit`() {
        val subscriber = LimitedBodySubscriber(3)
        subscriber.onSubscribe(object : Flow.Subscription {
            override fun request(n: Long) = Unit
            override fun cancel() = fail("Unexpected cancellation")
        })
        subscriber.onNext(listOf(ByteBuffer.wrap(byteArrayOf(1)), ByteBuffer.wrap(byteArrayOf(2, 3))))
        subscriber.onComplete()
        assertContentEquals(byteArrayOf(1, 2, 3), subscriber.body.toCompletableFuture().join())
    }
}
