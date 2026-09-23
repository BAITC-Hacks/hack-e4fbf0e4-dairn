package kz.hackalem.catalog.ekt

import java.net.URLEncoder
import java.net.http.HttpRequest
import java.nio.charset.StandardCharsets
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.time.Duration
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** Internal investigation/transport boundary, not the Product contract for Issue #3. */
internal class EktRawClient(
    private val config: EktConfig,
    private val transport: EktTransport = JdkEktTransport(),
) {
    fun listProducts(page: Int? = null): JsonElement = listResponse(page).json

    fun listResponse(page: Int? = null): EktJsonResponse {
        if (page != null && page < 1) throw EktException.InvalidRequest("Page must be positive")
        return get("/api/products" + (page?.let { "?page=$it" } ?: ""))
    }

    fun getProductDetails(id: String): JsonElement = detailResponse(id).json

    fun detailResponse(id: String): EktJsonResponse {
        if (id.isBlank() || id.any { it.isISOControl() }) {
            throw EktException.InvalidRequest("Product ID must be nonblank and contain no control characters")
        }
        return get("/api/products/detail?id=" + URLEncoder.encode(id, StandardCharsets.UTF_8))
    }

    private fun get(path: String): EktJsonResponse {
        val request = HttpRequest.newBuilder(config.baseUri.resolve(path))
            .timeout(Duration.ofSeconds(30))
            .header("Accept", "application/json")
            .header("Authorization", config.authorizationHeader())
            .GET().build()
        val response = transport.send(request)
        when (response.status) {
            401, 403 -> throw EktException.Authentication(response.status)
            404 -> throw EktException.NotFound()
            in 200..299 -> Unit
            else -> throw EktException.Http(response.status)
        }
        val mediaType = response.contentType?.substringBefore(';')?.trim()?.lowercase()
        if (mediaType != "application/json" && !(mediaType?.startsWith("application/") == true && mediaType.endsWith("+json"))) {
            throw EktException.InvalidResponse(response.status)
        }
        if (response.body.size > JdkEktTransport.MAX_RESPONSE_BYTES) throw EktException.InvalidResponse(response.status)
        return try {
            val text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(response.body)).toString()
            val parsed = Json.parseToJsonElement(text)
            if (parsed !is JsonObject && parsed !is JsonArray) throw EktException.InvalidResponse(response.status)
            EktJsonResponse(response.status, text, parsed)
        } catch (_: CharacterCodingException) {
            throw EktException.InvalidResponse(response.status)
        } catch (_: SerializationException) {
            throw EktException.InvalidResponse(response.status)
        } catch (_: IllegalArgumentException) {
            throw EktException.InvalidResponse(response.status)
        }
    }
}

/** Local investigation output only; never the public domain contract. */
internal class EktJsonResponse(val status: Int, val text: String, val json: JsonElement) {
    override fun toString(): String = "EktJsonResponse(status=$status, body=[redacted])"
}
