package kz.hackalem.catalog.prevalidation

/** Advisory assessments only. None of these types contains replacement product values. */
enum class ValidationStatus { valid, needs_normalization, ambiguous, insufficient_data }
enum class IssueType { missing, ambiguous, inconsistent_format, unit_issue, suspicious_value, mapping_uncertain }
enum class Severity { info, warning, error }
enum class HintOperation { trim_whitespace, parse_number, parse_boolean, normalize_unit, domain_review }

data class ValidationIssue(val field: String, val type: IssueType, val message: String, val severity: Severity)
data class MappingSuggestion(val sourceField: String, val targetField: String, val confidence: Double, val reason: String)
data class NormalizationHint(val field: String, val operation: HintOperation, val reason: String)

data class ValidationReport(
    val recordId: String,
    val status: ValidationStatus,
    val issues: List<ValidationIssue>,
    val mappingSuggestions: List<MappingSuggestion>,
    val normalizationHints: List<NormalizationHint>,
    val requiresReview: Boolean,
) {
    override fun toString() = "ValidationReport(status=$status, issues=${issues.size}, requiresReview=$requiresReview)"
}

enum class FailureCategory {
    disabled, configuration, insufficient_input, unsafe_input, input_too_large,
    timeout, interrupted, transport, api_error, response_too_large,
    refusal, incomplete_response, invalid_response, schema_validation,
}

sealed interface ValidationOutcome {
    data class Completed(val report: ValidationReport) : ValidationOutcome
    data class Failed(val category: FailureCategory) : ValidationOutcome
}

/** Raw source is always retained, including on AI failure; callers normalize source, not report text. */
class PrevalidationResult(val source: RawCatalogRecord, val outcome: ValidationOutcome) {
    fun metadata(): Map<String, String> = buildMap {
        put("recordId", source.recordId)
        when (val result = outcome) {
            is ValidationOutcome.Completed -> {
                put("status", result.report.status.name)
                put("issueCount", result.report.issues.size.toString())
                put("issueTypes", result.report.issues.map { it.type.name }.distinct().sorted().joinToString(","))
                put("requiresReview", result.report.requiresReview.toString())
            }
            is ValidationOutcome.Failed -> put("failure", result.category.name)
        }
    }
    override fun toString() = "PrevalidationResult(${metadata()})"
}

fun interface CatalogPrevalidator {
    fun validate(record: RawCatalogRecord): PrevalidationResult
}

/** Explicit bypass: never claims AI validation succeeded. */
object DisabledPrevalidator : CatalogPrevalidator {
    override fun validate(record: RawCatalogRecord) = PrevalidationResult(record, ValidationOutcome.Failed(FailureCategory.disabled))
}

internal class PrevalidationFailure(val category: FailureCategory) : RuntimeException(category.name)
