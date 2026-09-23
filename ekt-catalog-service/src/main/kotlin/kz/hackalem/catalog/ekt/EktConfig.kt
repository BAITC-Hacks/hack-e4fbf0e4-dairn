package kz.hackalem.catalog.ekt

import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.Base64

/** Backend-only configuration. Deliberately not a data class: secrets must not appear in toString(). */
class EktConfig private constructor(
    internal val baseUri: URI,
    private val username: String,
    private val password: String,
) {
    internal fun authorizationHeader(): String = "Basic " + Base64.getEncoder().encodeToString(
        "$username:$password".toByteArray(StandardCharsets.UTF_8),
    )

    override fun toString(): String = "EktConfig([redacted])"

    companion object {
        fun fromEnvironment(environment: Map<String, String> = System.getenv()): EktConfig {
            fun required(name: String): String = environment[name]?.takeIf { it.isNotBlank() }
                ?: throw EktException.Configuration("Missing environment variable: $name")

            val uri = try {
                URI(required("EKT_API_BASE_URL"))
            } catch (_: java.net.URISyntaxException) {
                throw EktException.Configuration("EKT_API_BASE_URL must be an HTTPS origin")
            }
            if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.rawUserInfo != null ||
                uri.rawQuery != null || uri.rawFragment != null ||
                uri.path !in listOf("", "/") || uri.port !in -1..65535 || uri.port == 0
            ) {
                throw EktException.Configuration("EKT_API_BASE_URL must be an HTTPS origin without credentials, path, query or fragment")
            }
            val username = required("EKT_API_USERNAME")
            val password = required("EKT_API_PASSWORD")
            if (':' in username || username.any { it.isISOControl() } || password.any { it.isISOControl() }) {
                throw EktException.Configuration("EKT credentials contain unsupported characters")
            }
            return EktConfig(uri, username, password)
        }
    }
}
