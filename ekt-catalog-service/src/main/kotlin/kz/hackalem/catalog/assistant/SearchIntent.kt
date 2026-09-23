package kz.hackalem.catalog.assistant

import kotlinx.serialization.json.*
import kz.hackalem.catalog.service.*

enum class SearchPurpose { search, analogs, clarification }
data class SearchIntent(
    val purpose: SearchPurpose, val productId: String?, val sku: String?,
    val terms: List<String>, val requirements: List<String>, val clarification: String?,
)
internal data class CandidateProposal(val id: String, val reason: String, val nameEvidence: String)

/** Strict extraction contracts. They contain user wishes / candidate IDs, never product facts. */
internal object SearchContracts {
    private fun str() = buildJsonObject { put("type", "string") }
    private fun nullable() = buildJsonObject { put("type", buildJsonArray { add("string"); add("null") }) }
    private fun array(item: JsonObject) = buildJsonObject { put("type", "array"); put("items", item) }
    private fun obj(vararg fields: Pair<String, JsonObject>) = buildJsonObject {
        put("type", "object"); put("properties", JsonObject(fields.toMap()))
        put("required", JsonArray(fields.map { JsonPrimitive(it.first) })); put("additionalProperties", false)
    }
    val intent = obj(
        "purpose" to buildJsonObject { put("type", "string"); put("enum", JsonArray(SearchPurpose.entries.map { JsonPrimitive(it.name) })) },
        "productId" to nullable(), "sku" to nullable(), "terms" to array(str()),
        "requirements" to array(str()), "clarification" to nullable(),
    )
    val candidates = obj("candidates" to array(obj("id" to str(), "reason" to str(), "nameEvidence" to str())))

    fun parseIntent(text: String, input: String): SearchIntent = guarded {
        val root = Json.parseToJsonElement(text).jsonObject
        keys(root, setOf("purpose", "productId", "sku", "terms", "requirements", "clarification"))
        fun optional(key: String) = root.getValue(key).let { if (it == JsonNull) null else string(it, 300) }
        fun excerpts(key: String): List<String> {
            val array = root.getValue(key).jsonArray
            if (array.size > 8) invalidAi()
            return array.map { string(it, 200) }.also { values -> if (values.any { !input.contains(it, ignoreCase = true) }) invalidAi() }
        }
        val result = SearchIntent(SearchPurpose.valueOf(string(root.getValue("purpose"), 20)), optional("productId"), optional("sku"), excerpts("terms"), excerpts("requirements"), optional("clarification"))
        for (identifier in listOfNotNull(result.productId, result.sku)) if (!input.contains(identifier, ignoreCase = true)) invalidAi()
        if (result.purpose == SearchPurpose.clarification) {
            if (result.clarification == null) invalidAi()
        } else {
            if (result.clarification != null || (result.productId == null && result.sku == null && result.terms.isEmpty())) invalidAi()
        }
        result
    }

    fun parseCandidates(text: String): List<CandidateProposal> = guarded {
        val root = Json.parseToJsonElement(text).jsonObject
        keys(root, setOf("candidates"))
        val array = root.getValue("candidates").jsonArray
        if (array.size > 5) invalidAi()
        array.map { element ->
            val row = element.jsonObject
            keys(row, setOf("id", "reason", "nameEvidence"))
            CandidateProposal(string(row.getValue("id"), 256), string(row.getValue("reason"), 500), string(row.getValue("nameEvidence"), 300).also { if (it.length < 3) invalidAi() })
        }.also { if (it.map { row -> row.id }.distinct().size != it.size) invalidAi() }
    }
    private fun keys(row: JsonObject, expected: Set<String>) { if (row.keys != expected) invalidAi() }
    private fun string(value: JsonElement, limit: Int): String {
        val primitive = value as? JsonPrimitive ?: invalidAi()
        if (!primitive.isString || primitive.content.isBlank() || primitive.content.length > limit || primitive.content.any { it.isISOControl() }) invalidAi()
        return primitive.content
    }
    private inline fun <T> guarded(block: () -> T): T = try { block() }
    catch (error: CatalogException) { throw error }
    catch (_: Exception) { invalidAi() }
}

internal fun invalidAi(): Nothing = throw CatalogException(CatalogError.AI_INVALID_RESPONSE)
