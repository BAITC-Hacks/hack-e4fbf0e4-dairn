package kz.hackalem.catalog.prevalidation

import kotlinx.serialization.json.*

/** One schema drives both the OpenAI request and local structural validation. */
internal object ReportContract {
    private fun string(vararg values: String) = buildJsonObject {
        put("type", "string")
        if (values.isNotEmpty()) put("enum", JsonArray(values.map(::JsonPrimitive)))
    }
    private fun obj(vararg fields: Pair<String, JsonObject>) = buildJsonObject {
        put("type", "object")
        put("properties", JsonObject(fields.toMap()))
        put("required", JsonArray(fields.map { JsonPrimitive(it.first) }))
        put("additionalProperties", false)
    }
    private fun array(item: JsonObject) = buildJsonObject { put("type", "array"); put("items", item) }
    val schema: JsonObject = obj(
        "recordId" to string(),
        "status" to string(*ValidationStatus.entries.map { it.name }.toTypedArray()),
        "issues" to array(obj(
            "field" to string(), "type" to string(*IssueType.entries.map { it.name }.toTypedArray()),
            "message" to string(), "severity" to string(*Severity.entries.map { it.name }.toTypedArray()),
        )),
        "mappingSuggestions" to array(obj(
            "sourceField" to string(), "targetField" to string(),
            "confidence" to buildJsonObject { put("type", "number"); put("minimum", 0); put("maximum", 1) },
            "reason" to string(),
        )),
        "normalizationHints" to array(obj(
            "field" to string(), "operation" to string(*HintOperation.entries.map { it.name }.toTypedArray()), "reason" to string(),
        )),
        "requiresReview" to buildJsonObject { put("type", "boolean") },
    )

    fun parse(text: String, record: RawCatalogRecord): ValidationReport {
        val value = try { Json.parseToJsonElement(text) } catch (_: Exception) { fail(FailureCategory.invalid_response) }
        validate(value, schema)
        val root = value.jsonObject
        val report = ValidationReport(
            root.str("recordId"), ValidationStatus.valueOf(root.str("status")),
            root.getValue("issues").jsonArray.map { it.jsonObject.let { o -> ValidationIssue(o.str("field"), IssueType.valueOf(o.str("type")), o.str("message"), Severity.valueOf(o.str("severity"))) } },
            root.getValue("mappingSuggestions").jsonArray.map { it.jsonObject.let { o -> MappingSuggestion(o.str("sourceField"), o.str("targetField"), o.getValue("confidence").jsonPrimitive.double, o.str("reason")) } },
            root.getValue("normalizationHints").jsonArray.map { it.jsonObject.let { o -> NormalizationHint(o.str("field"), HintOperation.valueOf(o.str("operation")), o.str("reason")) } },
            root.getValue("requiresReview").jsonPrimitive.boolean,
        )
        if (report.recordId != record.recordId) fail(FailureCategory.schema_validation)
        if (report.issues.any { it.field !in record.fieldPaths }) fail(FailureCategory.schema_validation)
        fun hasEvidence(path: String) = path in record.fieldPaths && record.valueAt(path).let { it != null && it != JsonNull }
        if (report.mappingSuggestions.any { !hasEvidence(it.sourceField) || it.targetField !in record.normalizedFields }) fail(FailureCategory.schema_validation)
        if (report.normalizationHints.any { !hasEvidence(it.field) }) fail(FailureCategory.schema_validation)
        if (report.status in setOf(ValidationStatus.ambiguous, ValidationStatus.insufficient_data) && !report.requiresReview) fail(FailureCategory.schema_validation)
        if (report.issues.any { it.severity == Severity.error } && !report.requiresReview) fail(FailureCategory.schema_validation)
        if (report.status == ValidationStatus.valid && (report.issues.isNotEmpty() || report.normalizationHints.isNotEmpty() || report.requiresReview)) fail(FailureCategory.schema_validation)
        return report
    }

    /** Validator for exactly the schema subset above; rejects unknown fields and scalar coercion. */
    private fun validate(value: JsonElement, schema: JsonObject) {
        fun check(condition: Boolean) { if (!condition) fail(FailureCategory.schema_validation) }
        when (schema.str("type")) {
            "object" -> {
                check(value is JsonObject)
                val properties = schema.getValue("properties").jsonObject
                check(value.jsonObject.keys == properties.keys)
                properties.forEach { (key, child) -> validate(value.jsonObject.getValue(key), child.jsonObject) }
            }
            "array" -> { check(value is JsonArray); check(value.jsonArray.size <= 100); value.jsonArray.forEach { validate(it, schema.getValue("items").jsonObject) } }
            "string" -> {
                check(value is JsonPrimitive && value.isString)
                check(value.jsonPrimitive.content.length in 1..2000)
                schema["enum"]?.let { check(value in it.jsonArray) }
            }
            "boolean" -> check(value is JsonPrimitive && !value.isString && value.booleanOrNull != null)
            "number" -> {
                check(value is JsonPrimitive && !value.isString)
                val number = value.jsonPrimitive.doubleOrNull
                check(number != null && number.isFinite() && number in 0.0..1.0)
            }
            else -> error("Unsupported local report schema")
        }
    }
}

internal fun JsonObject.str(key: String): String = getValue(key).jsonPrimitive.content
