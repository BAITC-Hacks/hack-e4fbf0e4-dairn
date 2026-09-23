package kz.hackalem.catalog.prevalidation

import kotlinx.serialization.json.*

/**
 * Input must be ONE product record, never an HTTP envelope or customer/session data.
 * fieldPaths is an explicit allowlist of JSON pointers supplied by trusted #2 code.
 * normalizedFields is empty until #2 establishes a real Product contract.
 */
class RawCatalogRecord(
    val recordId: String,
    raw: JsonObject,
    fieldPaths: Set<String>,
    normalizedFields: Set<String> = emptySet(),
) {
    private val snapshot = raw.toString()
    val raw: JsonObject get() = Json.parseToJsonElement(snapshot).jsonObject
    val fieldPaths: Set<String> = java.util.Set.copyOf(fieldPaths)
    val normalizedFields: Set<String> = java.util.Set.copyOf(normalizedFields)

    init {
        // Local correlation ID, not an AI-invented EKT identifier. Safe for metadata logging.
        require(recordId.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "Invalid local record reference" }
    }

    internal fun selectedFields(): JsonObject {
        if (snapshot.toByteArray(Charsets.UTF_8).size > MAX_INPUT_BYTES) fail(FailureCategory.input_too_large)
        if (fieldPaths.isEmpty() || fieldPaths.size > 100 || normalizedFields.size > 100) fail(FailureCategory.insufficient_input)
        if (normalizedFields.any { !it.matches(Regex("[A-Za-z][A-Za-z0-9_.]{0,127}")) || sensitive(it) }) fail(FailureCategory.unsafe_input)
        val source = raw
        val fields = buildJsonObject {
            for (path in fieldPaths.sorted()) {
                val value = lookup(source, path)
                if (value != null && containsSensitiveData(value)) fail(FailureCategory.unsafe_input)
                put(path, buildJsonObject {
                    put("present", value != null)
                    put("value", value ?: JsonNull)
                })
            }
        }
        if (fields.values.none { it.jsonObject.getValue("present").jsonPrimitive.boolean && it.jsonObject["value"] != JsonNull }) {
            fail(FailureCategory.insufficient_input)
        }
        return fields
    }

    internal fun valueAt(path: String): JsonElement? = lookup(raw, path)
    override fun toString() = "RawCatalogRecord(recordId=$recordId, raw=[redacted])"

    companion object { const val MAX_INPUT_BYTES = 64 * 1024 }
}

private fun lookup(root: JsonElement, path: String): JsonElement? {
    if (!path.startsWith('/') || path.length > 256 || path.any { it.isISOControl() } || Regex("~(?![01])").containsMatchIn(path)) fail(FailureCategory.unsafe_input)
    val parts = path.drop(1).split('/').map { it.replace("~1", "/").replace("~0", "~") }
    if (parts.any { it.isEmpty() || sensitive(it) }) fail(FailureCategory.unsafe_input)
    var node: JsonElement? = root
    for (part in parts) node = when (val current = node) {
        is JsonObject -> current[part]
        is JsonArray -> part.toIntOrNull()?.takeIf { it >= 0 && it.toString() == part }?.let { current.getOrNull(it) }
        else -> null
    }
    return node
}

private fun sensitive(key: String): Boolean {
    val normalized = key.lowercase().filter { it.isLetterOrDigit() }
    return listOf("authorization", "password", "passwd", "secret", "apikey", "token", "cookie", "credential", "headers", "customer", "session").any { it in normalized }
}

private fun containsSensitiveData(value: JsonElement): Boolean = when (value) {
    is JsonObject -> value.any { (key, child) -> sensitive(key) || containsSensitiveData(child) }
    is JsonArray -> value.any(::containsSensitiveData)
    is JsonPrimitive -> value.isString && Regex("(?i)(bearer\\s+|basic\\s+[a-z0-9+/=]+|sk-[a-z0-9_-]{8,}|https?://[^\\s/]+:[^\\s/]+@)").containsMatchIn(value.content)
}

internal fun fail(category: FailureCategory): Nothing = throw PrevalidationFailure(category)
