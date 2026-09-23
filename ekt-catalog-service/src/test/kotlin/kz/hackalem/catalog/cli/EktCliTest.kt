package kz.hackalem.catalog.cli

import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.io.PrintStream
import java.net.http.HttpRequest
import java.nio.file.Files
import java.nio.file.Path
import kz.hackalem.catalog.ekt.*
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import kotlin.test.*

class EktCliTest {
    @get:Rule val temporary = TemporaryFolder()
    private val environment = mapOf(
        "EKT_API_BASE_URL" to "https://catalog.example.test",
        "EKT_API_USERNAME" to "fixture-user",
        "EKT_API_PASSWORD" to "fixture-secret",
    )
    // Deliberately synthetic: transport fixtures are not evidence of the EKT schema.
    private val json = """{ "unknown": [1.2300, null, "текст"] }"""
    private data class Result(val code: Int, val out: String, val err: String)

    private fun run(
        vararg args: String,
        env: () -> Map<String, String> = { environment },
        send: (HttpRequest) -> TransportResponse = { TransportResponse(200, "application/json", json.toByteArray()) },
    ): Result {
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val cli = EktCli(env, { EktTransport(send) }, PrintStream(out, true, Charsets.UTF_8), PrintStream(err, true, Charsets.UTF_8))
        val code = cli.run(arrayOf(*args))
        return Result(code, out.toString(Charsets.UTF_8), err.toString(Charsets.UTF_8))
    }

    @Test fun `help does not read environment or contact the network`() {
        val result = run("--help", env = { error("Environment must not be read") }, send = { error("No network") })
        assertEquals(0, result.code)
        assertTrue("list" in result.out && "detail" in result.out)
        assertEquals("", result.err)
    }

    @Test fun `list page and detail commands reuse exact client requests`() {
        val requests = mutableListOf<HttpRequest>()
        val commands = listOf(arrayOf("list"), arrayOf("list", "--page", "1"), arrayOf("list", "--page", "2"),
            arrayOf("detail", "--id", "a /&?ю"))
        for (command in commands) {
            val result = run(*command, send = {
                requests += it
                TransportResponse(200, "application/json", json.toByteArray())
            })
            assertEquals(0, result.code)
            assertEquals(json + "\n", result.out)
            assertTrue("success (HTTP 200)" in result.err)
            assertFalse("fixture-secret" in result.err)
        }
        assertEquals(listOf("/api/products", "/api/products", "/api/products", "/api/products/detail"), requests.map { it.uri().path })
        assertEquals(listOf(null, "page=1", "page=2", "id=a+%2F%26%3F%D1%8E"), requests.map { it.uri().rawQuery })
        assertTrue(requests.all { it.method() == "GET" && it.headers().firstValue("Authorization").isPresent })
    }

    @Test fun `bad arguments fail before configuration or networking without echoing inputs`() {
        val cases = listOf(emptyArray(), arrayOf("fixture-secret"), arrayOf("list", "--unknown"),
            arrayOf("list", "--page"), arrayOf("list", "--page", "0"), arrayOf("list", "--page", "-1"),
            arrayOf("list", "--page", "2147483648"), arrayOf("list", "--page", "x"),
            arrayOf("list", "--page", "1", "--page", "2"), arrayOf("list", "extra"),
            arrayOf("detail"), arrayOf("detail", "--id"), arrayOf("detail", "--id", ""),
            arrayOf("detail", "--id", "x\n"), arrayOf("detail", "--id", "--output", "file"),
            arrayOf("detail", "--page", "1"), arrayOf("list", "--output"),
            arrayOf("list", "--output", "\u0000"), arrayOf("--help", "list"))
        for (args in cases) {
            val result = run(*args, env = { error("Unexpected config access") }, send = { error("Unexpected network") })
            assertEquals(2, result.code)
            assertEquals("", result.out)
            assertTrue("--help" in result.err)
            assertFalse("fixture-secret" in result.err)
        }
    }

    @Test fun `missing configuration has exit 2 and names only the missing variable`() {
        for (key in environment.keys) {
            val result = run("list", env = { environment - key }, send = { error("Unexpected network") })
            assertEquals(2, result.code)
            assertEquals("", result.out)
            assertTrue(key in result.err)
            assertFalse("fixture-secret" in result.err)
        }
    }

    @Test fun `export creates parents and preserves the actual JSON without stdout chatter`() {
        val target = temporary.root.toPath().resolve("nested/evidence.json")
        val result = run("list", "--page", "1", "--output", target.toString())
        assertEquals(0, result.code)
        assertEquals("", result.out)
        assertEquals(json + "\n", Files.readString(target))
        assertTrue("HTTP 200" in result.err)
        assertOnlyTarget(target)
    }

    @Test fun `existing output is preserved and fails before a request`() {
        val target = temporary.newFile("existing.json").toPath()
        Files.writeString(target, "original")
        val result = run("list", "--output", target.toString(), send = { error("Unexpected network") })
        assertEquals(4, result.code)
        assertEquals("original", Files.readString(target))
        assertEquals("", result.out)
        assertTrue("already exists" in result.err)
    }

    @Test fun `a racing writer cannot be overwritten by export`() {
        val target = temporary.root.toPath().resolve("race.json")
        val result = run("list", "--output", target.toString(), send = {
            Files.writeString(target, "other-writer")
            TransportResponse(200, "application/json", json.toByteArray())
        })
        assertEquals(4, result.code)
        assertEquals("other-writer", Files.readString(target))
        assertOnlyTarget(target)
    }

    @Test fun `dangling symlink is not replaced`() {
        val target = temporary.root.toPath().resolve("link.json")
        Files.createSymbolicLink(target, Path.of("missing.json"))
        val result = run("list", "--output", target.toString(), send = { error("Unexpected network") })
        assertEquals(4, result.code)
        assertTrue(Files.isSymbolicLink(target))
    }

    @Test fun `file write failure is nonzero with no output or response body leak`() {
        val parentFile = temporary.newFile("fixture-secret")
        val target = parentFile.toPath().resolve("evidence.json")
        val result = run("list", "--output", target.toString())
        assertEquals(4, result.code)
        assertEquals("", result.out)
        assertFalse(Files.exists(target))
        assertFalse("fixture-secret" in result.err)
        assertTrue("HTTP 200" in result.err)
    }

    @Test fun `HTTP failures do not export files or leak response bodies`() {
        for (status in listOf(401, 403, 404, 429, 500)) {
            val target = temporary.root.toPath().resolve("failure-$status.json")
            val result = run("detail", "--id", "fixture-secret", "--output", target.toString(), send = {
                TransportResponse(status, "text/html", "fixture-secret Authorization: Basic secret".toByteArray())
            })
            assertEquals(3, result.code)
            assertEquals("", result.out)
            assertTrue("detail: failure" in result.err && "HTTP $status" in result.err)
            assertFalse("fixture-secret" in result.err || "Authorization" in result.err)
            assertFalse(Files.exists(target))
        }
    }

    @Test fun `timeout unavailable and malformed JSON never become successful empty JSON`() {
        val failures: List<(HttpRequest) -> TransportResponse> = listOf(
            { throw EktException.Timeout() }, { throw EktException.Unavailable() },
            { TransportResponse(200, "application/json", "{ fixture-secret".toByteArray()) },
        )
        failures.forEachIndexed { index, send ->
            val target = temporary.root.toPath().resolve("failed-$index.json")
            val result = run("list", "--output", target.toString(), send = send)
            assertEquals(3, result.code)
            assertEquals("", result.out)
            assertFalse(Files.exists(target))
            assertFalse("fixture-secret" in result.err)
            if (index == 2) assertTrue("HTTP 200" in result.err)
        }
    }

    @Test fun `broken stdout returns output error`() {
        val broken = PrintStream(object : OutputStream() { override fun write(b: Int) { throw java.io.IOException("fixture-secret") } })
        val err = ByteArrayOutputStream()
        val cli = EktCli({ environment }, { EktTransport { TransportResponse(200, "application/json", json.toByteArray()) } }, broken, PrintStream(err))
        assertEquals(4, cli.run(arrayOf("list")))
        assertFalse("fixture-secret" in err.toString())
    }

    @Test fun `unexpected failure is sanitized`() {
        val result = run("list", send = { error("fixture-secret Authorization: Basic secret") })
        assertEquals(1, result.code)
        assertEquals("", result.out)
        assertFalse("fixture-secret" in result.err || "Authorization" in result.err)
    }

    private fun assertOnlyTarget(target: Path) {
        Files.list(target.parent).use { assertEquals(listOf(target), it.toList()) }
    }
}
