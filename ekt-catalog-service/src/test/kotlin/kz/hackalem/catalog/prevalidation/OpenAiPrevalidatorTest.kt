package kz.hackalem.catalog.prevalidation

import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlinx.serialization.json.*
import kotlin.test.*

class OpenAiPrevalidatorTest {
    private val fixtures = Json.parseToJsonElement(javaClass.getResource("/prevalidation/synthetic-records.json")!!.readText()).jsonObject
    private val config = OpenAiConfig.fromEnvironment(mapOf("OPENAI_API_KEY" to "test-provider-secret", "OPENAI_MODEL" to "test-model"))
    private fun record(name: String = "wellFormed") = RawCatalogRecord("local-1", fixtures.getValue(name).jsonObject, setOf("/name", "/price", "/stock", "/specs"))
    private fun report(status: String = "valid", review: Boolean = false) = buildJsonObject {
        put("recordId", "local-1"); put("status", status)
        put("issues", JsonArray(emptyList())); put("mappingSuggestions", JsonArray(emptyList()))
        put("normalizationHints", JsonArray(emptyList())); put("requiresReview", review)
    }
    private fun envelope(report: JsonObject) = buildJsonObject {
        put("status", "completed")
        put("output", buildJsonArray { add(buildJsonObject {
            put("type", "message"); put("role", "assistant"); put("status", "completed")
            put("content", buildJsonArray { add(buildJsonObject { put("type", "output_text"); put("text", report.toString()) }) })
        }) })
    }
    private fun service(body: JsonObject = envelope(report())) = OpenAiPrevalidator(config) { OpenAiResponse(200, body.toString().toByteArray()) }
    private fun failed(expected: FailureCategory, result: PrevalidationResult) = assertEquals(ValidationOutcome.Failed(expected), result.outcome)
    private fun replace(root: JsonObject, key: String, value: JsonElement) = JsonObject(root + (key to value))

    @Test fun `request uses strict schema and only selected product data`() {
        val raw = Json.parseToJsonElement("""{"name":"cable","stock":null,"password":"ekt-secret","customer":{"email":"private"}}""").jsonObject
        val input = RawCatalogRecord("local-1", raw, setOf("/name", "/stock", "/price"))
        var captured: JsonObject? = null
        val validator = OpenAiPrevalidator(config) { request ->
            assertEquals("https://api.openai.com/v1/responses", request.uri().toString())
            assertEquals("Bearer test-provider-secret", request.headers().firstValue("Authorization").get())
            assertEquals(config.timeout, request.timeout().get())
            captured = Json.parseToJsonElement(body(request)).jsonObject
            OpenAiResponse(200, envelope(report()).toString().toByteArray())
        }
        val result = validator.validate(input)
        assertIs<ValidationOutcome.Completed>(result.outcome)
        assertSame(input, result.source)
        assertEquals(raw, result.source.raw)
        val request = captured!!
        assertEquals(JsonPrimitive(false), request["store"])
        val format = request.getValue("text").jsonObject.getValue("format").jsonObject
        assertEquals(JsonPrimitive(true), format["strict"])
        assertEquals(ReportContract.schema, format["schema"])
        val selected = Json.parseToJsonElement(request.str("input")).jsonObject.getValue("fields").jsonObject
        assertEquals(JsonNull, selected.getValue("/stock").jsonObject["value"])
        assertEquals(JsonPrimitive(true), selected.getValue("/stock").jsonObject["present"])
        assertEquals(JsonPrimitive(false), selected.getValue("/price").jsonObject["present"])
        for (secret in listOf("ekt-secret", "private", "test-provider-secret")) assertFalse(request.toString().contains(secret))
        assertFalse(input.toString().contains("ekt-secret"))
    }

    @Test fun `synthetic cases keep original facts including missing null and zero`() {
        for (name in fixtures.keys - "incomplete") {
            val source = record(name)
            val original = source.raw.toString()
            val result = service(envelope(report("ambiguous", true))).validate(source)
            assertIs<ValidationOutcome.Completed>(result.outcome)
            assertEquals(original, result.source.raw.toString())
            assertEquals("ambiguous", result.metadata()["status"])
        }
        val zero = RawCatalogRecord("local-1", buildJsonObject { put("stock", 0); put("price", JsonNull) }, setOf("/stock", "/price"))
        assertEquals(JsonPrimitive(0), service().validate(zero).source.raw["stock"])
        assertEquals(JsonNull, service().validate(zero).source.raw["price"])
    }

    @Test fun `empty data fails before network`() {
        val validator = OpenAiPrevalidator(config) { error("Network must not be called") }
        failed(FailureCategory.insufficient_input, validator.validate(record("incomplete")))
        failed(FailureCategory.insufficient_input, validator.validate(RawCatalogRecord("local-1", buildJsonObject { put("stock", JsonNull) }, setOf("/stock"))))
    }

    @Test fun `secret fields nested secrets and credentials are rejected`() {
        val validator = OpenAiPrevalidator(config) { error("Network must not be called") }
        for ((raw, path) in listOf(
            """{"Authorization":"Basic abc"}""" to "/Authorization",
            """{"specs":{"api_key":"private"}}""" to "/specs",
            """{"name":"Bearer private"}""" to "/name",
            """{"name":"test-provider-secret"}""" to "/name",
        )) failed(FailureCategory.unsafe_input, validator.validate(RawCatalogRecord("local-1", Json.parseToJsonElement(raw).jsonObject, setOf(path))))
    }

    @Test fun `invalid pointer and oversize source never reach network`() {
        val validator = OpenAiPrevalidator(config) { error("Network must not be called") }
        for (path in listOf("", "name", "/bad~3escape", "/headers/token", "/")) {
            failed(FailureCategory.unsafe_input, validator.validate(RawCatalogRecord("local-1", record().raw, setOf(path))))
        }
        failed(FailureCategory.input_too_large, validator.validate(RawCatalogRecord("local-1", buildJsonObject { put("name", "a".repeat(65536)) }, setOf("/name"))))
    }

    @Test fun `source snapshot is independent of mutable caller collections`() {
        val fields = mutableMapOf<String, JsonElement>("stock" to JsonNull)
        val paths = mutableSetOf("/stock")
        val input = RawCatalogRecord("local-1", JsonObject(fields), paths)
        fields["stock"] = JsonPrimitive(100)
        paths.add("/password")
        assertEquals(JsonNull, input.raw["stock"])
        assertEquals(setOf("/stock"), input.fieldPaths)
    }

    @Test fun `overlapping selected subtrees cannot amplify outbound input above limit`() {
        val source = buildJsonObject { put("specs", buildJsonObject { put("description", "a".repeat(40_000)) }) }
        val record = RawCatalogRecord("local-1", source, setOf("/specs", "/specs/description"))
        val validator = OpenAiPrevalidator(config) { error("Network must not be called") }
        failed(FailureCategory.input_too_large, validator.validate(record))
    }

    @Test fun `strict contract rejects fabricated values unknown enums and scalar coercion`() {
        val invalid = listOf(
            replace(report(), "price", JsonPrimitive(0)),
            JsonObject(report() - "requiresReview"),
            replace(report(), "requiresReview", JsonPrimitive("false")),
            replace(report(), "status", JsonPrimitive("probably_valid")),
            replace(report(), "issues", JsonNull),
            replace(report(), "recordId", JsonPrimitive("invented-id")),
            report("ambiguous", false), report("insufficient_data", false),
        )
        for (value in invalid) failed(FailureCategory.schema_validation, service(envelope(value)).validate(record()))
    }

    @Test fun `mapping must reference evidence and an explicitly permitted target`() {
        fun mapping(source: String, target: String, confidence: JsonElement = JsonPrimitive(0.8)) = replace(report("needs_normalization"), "mappingSuggestions", buildJsonArray { add(buildJsonObject {
            put("sourceField", source); put("targetField", target); put("confidence", confidence); put("reason", "Source contains the label")
        }) })
        val input = RawCatalogRecord("local-1", record().raw, setOf("/name", "/missing"), setOf("name"))
        assertIs<ValidationOutcome.Completed>(service(envelope(mapping("/name", "name"))).validate(input).outcome)
        for (invalid in listOf(mapping("/missing", "name"), mapping("/stock", "name"), mapping("/name", "price"), mapping("/name", "name", JsonPrimitive(2)), mapping("/name", "name", JsonPrimitive("0.8")))) {
            failed(FailureCategory.schema_validation, service(envelope(invalid)).validate(input))
        }
        failed(FailureCategory.schema_validation, service(envelope(mapping("/name", "name"))).validate(record()))
    }

    @Test fun `missing issues are allowed but invented references and replacement operations are not`() {
        fun issue(path: String) = replace(report("insufficient_data", true), "issues", buildJsonArray { add(buildJsonObject {
            put("field", path); put("type", "missing"); put("severity", "error"); put("message", "No stock evidence")
        }) })
        val source = record("missingOptional")
        assertIs<ValidationOutcome.Completed>(service(envelope(issue("/price"))).validate(source).outcome)
        failed(FailureCategory.schema_validation, service(envelope(issue("/invented"))).validate(source))
        val hint = replace(report("needs_normalization"), "normalizationHints", buildJsonArray { add(buildJsonObject {
            put("field", "/stock"); put("operation", "set_zero"); put("reason", "Guess")
        }) })
        failed(FailureCategory.schema_validation, service(envelope(hint)).validate(source))
    }

    @Test fun `refusal incomplete and malformed outputs fail explicitly`() {
        val refusal = buildJsonObject { put("status", "completed"); put("output", buildJsonArray { add(buildJsonObject {
            put("type", "message"); put("content", buildJsonArray { add(buildJsonObject { put("type", "refusal"); put("refusal", "No") }) })
        }) }) }
        failed(FailureCategory.refusal, service(refusal).validate(record()))
        failed(FailureCategory.incomplete_response, service(replace(envelope(report()), "status", JsonPrimitive("incomplete"))).validate(record()))
        failed(FailureCategory.invalid_response, service(buildJsonObject {}).validate(record()))
        failed(FailureCategory.invalid_response, OpenAiPrevalidator(config) { OpenAiResponse(200, "not-json".toByteArray()) }.validate(record()))
        failed(FailureCategory.response_too_large, OpenAiPrevalidator(config) { OpenAiResponse(200, ByteArray(256 * 1024 + 1)) }.validate(record()))
    }

    @Test fun `failures retain source and never become successful reports`() {
        val source = record()
        for (category in listOf(FailureCategory.timeout, FailureCategory.interrupted, FailureCategory.transport)) {
            val result = OpenAiPrevalidator(config) { fail(category) }.validate(source)
            failed(category, result)
            assertSame(source, result.source)
            assertEquals(category.name, result.metadata()["failure"])
        }
        for (status in listOf(301, 401, 403, 429, 500)) failed(FailureCategory.api_error, OpenAiPrevalidator(config) { OpenAiResponse(status, "secret error body".toByteArray()) }.validate(source))
        val result = OpenAiPrevalidator(config) { error("password secret") }.validate(source)
        failed(FailureCategory.transport, result)
        assertFalse(result.toString().contains("password"))
    }

    @Test fun `disabled and misconfigured modes do not require network or credentials`() {
        failed(FailureCategory.disabled, OpenAiPrevalidator.fromEnvironment(emptyMap()).validate(record()))
        failed(FailureCategory.configuration, OpenAiPrevalidator.fromEnvironment(mapOf("OPENAI_PREVALIDATION_ENABLED" to "true")).validate(record()))
        failed(FailureCategory.configuration, OpenAiPrevalidator.fromEnvironment(mapOf("OPENAI_PREVALIDATION_ENABLED" to "yes")).validate(record()))
        assertEquals("OpenAiConfig([redacted])", config.toString())
        assertEquals("test-model", config.model)
        for (override in listOf("OPENAI_TIMEOUT_MS" to "0", "OPENAI_MAX_OUTPUT_TOKENS" to "999999", "OPENAI_API_KEY" to "unsafe\nkey", "OPENAI_MODEL" to "")) {
            val error = assertFailsWith<PrevalidationFailure> { OpenAiConfig.fromEnvironment(mapOf("OPENAI_API_KEY" to "test", "OPENAI_MODEL" to "test") + override) }
            assertEquals(FailureCategory.configuration, error.category)
            assertEquals("configuration", error.message)
        }
    }

    @Test fun `normalization can read raw data after AI failure without report dependency`() {
        val source = record("unknownStock")
        val result = OpenAiPrevalidator(config) { fail(FailureCategory.timeout) }.validate(source)
        // Illustrates the handoff only, not the absent #2 normalizer.
        assertEquals(JsonNull, result.source.raw["stock"])
        assertFalse(result.source.raw.containsKey("price"))
        assertIs<ValidationOutcome.Failed>(result.outcome)
    }

    private fun body(request: HttpRequest): String {
        val subscriber = HttpResponse.BodySubscribers.ofByteArray()
        request.bodyPublisher().get().subscribe(object : java.util.concurrent.Flow.Subscriber<java.nio.ByteBuffer> {
            override fun onSubscribe(subscription: java.util.concurrent.Flow.Subscription) = subscriber.onSubscribe(subscription)
            override fun onNext(item: java.nio.ByteBuffer) = subscriber.onNext(listOf(item))
            override fun onError(error: Throwable) = subscriber.onError(error)
            override fun onComplete() = subscriber.onComplete()
        })
        return subscriber.body.toCompletableFuture().get().decodeToString()
    }
}
