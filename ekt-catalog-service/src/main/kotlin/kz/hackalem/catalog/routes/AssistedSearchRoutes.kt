package kz.hackalem.catalog.routes

import io.ktor.http.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kz.hackalem.catalog.assistant.*
import kz.hackalem.catalog.service.*

fun Route.assistedSearchRoutes(service: AiSearchService) {
    post("/api/catalog/assist/search") {
        if (!call.request.contentType().match(ContentType.Application.Json)) throw CatalogException(CatalogError.INVALID_AI_QUERY)
        val bytes = ByteArray(8193)
        var size = 0
        val channel = call.receiveChannel()
        try {
            withTimeout(5000) {
                while (size < bytes.size) {
                    val read = channel.readAvailable(bytes, size, bytes.size - size)
                    if (read == -1) break
                    size += read
                }
            }
        } catch (_: TimeoutCancellationException) { throw CatalogException(CatalogError.INVALID_AI_QUERY) }
        if (size > 8192) throw CatalogException(CatalogError.AI_REQUEST_TOO_LARGE)
        val text = try {
            val body = Json.parseToJsonElement(bytes.copyOf(size).decodeToString(throwOnInvalidSequence = true)).jsonObject
            if (body.keys != setOf("text")) throw IllegalArgumentException()
            val value = body.getValue("text").jsonPrimitive
            if (!value.isString) throw IllegalArgumentException()
            value.content
        } catch (_: Exception) { throw CatalogException(CatalogError.INVALID_AI_QUERY) }
        val result = service.search(text)
        call.response.headers.append(HttpHeaders.CacheControl, "no-store")
        call.respondText(result.json().toString(), ContentType.Application.Json)
    }
}

private fun AssistedSearchResponse.json() = buildJsonObject {
    put("status", status)
    put("interpretation", buildJsonObject {
        put("purpose", interpretation.purpose.name)
        put("productId", interpretation.productId?.let(::JsonPrimitive) ?: JsonNull)
        put("sku", interpretation.sku?.let(::JsonPrimitive) ?: JsonNull)
        put("terms", JsonArray(interpretation.terms.map(::JsonPrimitive)))
        put("requirements", JsonArray(interpretation.requirements.map(::JsonPrimitive)))
        put("clarification", interpretation.clarification?.let(::JsonPrimitive) ?: JsonNull)
    })
    put("sourceProduct", sourceProduct?.json() ?: JsonNull)
    put("candidates", JsonArray(candidates.map { candidate -> buildJsonObject {
        put("product", candidate.product.json()); put("aiReason", candidate.aiReason)
        put("nameEvidence", candidate.nameEvidence)
        put("compatibility", "UNVERIFIED"); put("requirementsVerified", false)
    } }))
    put("metadata", metadata?.json() ?: JsonNull)
    put("consideredProducts", consideredProducts)
    put("verifiedAnalogs", false)
}
