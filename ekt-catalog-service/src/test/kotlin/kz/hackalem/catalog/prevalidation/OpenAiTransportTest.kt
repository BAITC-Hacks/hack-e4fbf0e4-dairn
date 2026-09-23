package kz.hackalem.catalog.prevalidation

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.net.http.HttpRequest
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.*

class OpenAiTransportTest {
    @Test fun `deadline covers stalled success and error bodies`() {
        for (status in listOf(200, 500)) {
            val headersSent = CountDownLatch(1)
            val release = CountDownLatch(1)
            withServer { server ->
                server.createContext("/") { exchange ->
                    exchange.sendResponseHeaders(status, 100)
                    exchange.responseBody.write(byteArrayOf(1))
                    exchange.responseBody.flush()
                    headersSent.countDown()
                    release.await(5, TimeUnit.SECONDS)
                    exchange.close()
                }
                try {
                    val start = System.nanoTime()
                    val failure = assertFailsWith<PrevalidationFailure> { JdkOpenAiTransport().send(request(server, 750)) }
                    assertEquals(FailureCategory.timeout, failure.category)
                    assertTrue(headersSent.await(1, TimeUnit.SECONDS), "Server must have sent headers")
                    assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 3000)
                } finally { release.countDown() }
            }
        }
    }

    @Test fun `redirect is not followed and error bodies are discarded`() = withServer { server ->
        val redirected = AtomicBoolean(false)
        server.createContext("/") { exchange ->
            exchange.responseHeaders.add("Location", "/target")
            val body = "private error body".toByteArray()
            exchange.sendResponseHeaders(302, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/target") { exchange -> redirected.set(true); exchange.sendResponseHeaders(204, -1); exchange.close() }
        val response = JdkOpenAiTransport().send(request(server))
        assertEquals(302, response.status)
        assertTrue(response.body.isEmpty())
        assertFalse(redirected.get())
    }

    @Test fun `transport limits actual response bytes`() = withServer { server ->
        server.createContext("/") { exchange ->
            val body = ByteArray(JdkOpenAiTransport.MAX_RESPONSE_BYTES + 1)
            exchange.sendResponseHeaders(200, body.size.toLong())
            try { exchange.responseBody.use { it.write(body) } } catch (_: java.io.IOException) { exchange.close() }
        }
        val failure = assertFailsWith<PrevalidationFailure> { JdkOpenAiTransport().send(request(server)) }
        assertEquals(FailureCategory.response_too_large, failure.category)
    }

    private fun request(server: HttpServer, timeoutMs: Long = 3000) = HttpRequest.newBuilder(
        URI.create("http://127.0.0.1:${server.address.port}/")
    ).timeout(Duration.ofMillis(timeoutMs)).GET().build()

    private fun withServer(block: (HttpServer) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val executor = Executors.newCachedThreadPool()
        server.executor = executor
        server.start()
        try { block(server) } finally { server.stop(0); executor.shutdownNow() }
    }
}
