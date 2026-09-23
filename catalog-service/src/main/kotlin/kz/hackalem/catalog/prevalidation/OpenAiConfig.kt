package kz.hackalem.catalog.prevalidation

import java.time.Duration

class OpenAiConfig private constructor(
    internal val apiKey: String,
    val model: String,
    val timeout: Duration,
    val maxOutputTokens: Int,
) {
    override fun toString() = "OpenAiConfig([redacted])"

    companion object {
        fun fromEnvironment(environment: Map<String, String> = System.getenv()): OpenAiConfig {
            val key = environment["OPENAI_API_KEY"]?.takeIf { it.isNotBlank() && it.length <= 1024 && it.all { ch -> ch.code in 33..126 } }
                ?: fail(FailureCategory.configuration)
            // Explicit model choice: no moving alias or provider choice buried in prompts.
            val model = environment["OPENAI_MODEL"]?.takeIf { it.matches(Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")) }
                ?: fail(FailureCategory.configuration)
            fun integer(key: String, default: Int, range: IntRange): Int {
                val value = environment[key]?.toIntOrNull() ?: if (key !in environment) default else fail(FailureCategory.configuration)
                return value.takeIf { it in range } ?: fail(FailureCategory.configuration)
            }
            return OpenAiConfig(key, model,
                Duration.ofMillis(integer("OPENAI_TIMEOUT_MS", 30_000, 1..120_000).toLong()),
                integer("OPENAI_MAX_OUTPUT_TOKENS", 2048, 256..8192))
        }
    }
}
