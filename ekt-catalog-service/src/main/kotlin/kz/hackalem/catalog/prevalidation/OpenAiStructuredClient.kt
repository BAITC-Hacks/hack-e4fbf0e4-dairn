package kz.hackalem.catalog.prevalidation

import java.net.URI
import java.net.http.HttpRequest
import kotlinx.serialization.json.*

/** Shared bounded Responses API client; callers validate their own domain-specific schema. */
internal fun interface StructuredAi {
    fun complete(name: String, schema: JsonObject, instructions: String, input: JsonObject): String
}

internal class OpenAiStructuredClient(
    private val config: OpenAiConfig,
    private val transport: OpenAiTransport = JdkOpenAiTransport(),
) : StructuredAi {
    override fun complete(name: String, schema: JsonObject, instructions: String, input: JsonObject): String {
        val serialized = input.toString()
        if (serialized.toByteArray(Charsets.UTF_8).size > 64 * 1024) fail(FailureCategory.input_too_large)
        if (serialized.contains(config.apiKey)) fail(FailureCategory.unsafe_input)
        val body = buildJsonObject {
            put("model", config.model); put("store", false)
            put("max_output_tokens", config.maxOutputTokens); put("instructions", instructions)
            put("input", serialized)
            put("text", buildJsonObject { put("format", buildJsonObject {
                put("type", "json_schema"); put("name", name); put("strict", true); put("schema", schema)
            }) })
        }.toString()
        val request = HttpRequest.newBuilder(URI.create("https://api.openai.com/v1/responses"))
            .timeout(config.timeout).header("Authorization", "Bearer ${config.apiKey}")
            .header("Content-Type", "application/json").header("Accept", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build()
        val response = transport.send(request)
        if (response.status !in 200..299) fail(FailureCategory.api_error)
        if (response.body.size > JdkOpenAiTransport.MAX_RESPONSE_BYTES) fail(FailureCategory.response_too_large)
        return extractReport(response.body)
    }
}

private fun extractReport(bytes: ByteArray): String = try {
    val root = Json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true)).jsonObject
    if (root.str("status") != "completed") fail(FailureCategory.incomplete_response)
    val messages = root.getValue("output").jsonArray.map { it.jsonObject }.filter { it.str("type") == "message" }
    val content = messages.flatMap { it.getValue("content").jsonArray }.map { it.jsonObject }
    if (content.any { it.str("type") == "refusal" }) fail(FailureCategory.refusal)
    if (messages.size != 1 || messages.single().str("role") != "assistant" || messages.single().str("status") != "completed") fail(FailureCategory.invalid_response)
    if (content.size != 1 || content.single().str("type") != "output_text") fail(FailureCategory.invalid_response)
    val text = content.single().getValue("text").jsonPrimitive
    if (!text.isString) fail(FailureCategory.invalid_response)
    text.content
} catch (failure: PrevalidationFailure) { throw failure }
catch (_: Exception) { fail(FailureCategory.invalid_response) }
