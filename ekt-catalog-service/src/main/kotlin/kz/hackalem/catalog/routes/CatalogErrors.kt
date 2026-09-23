package kz.hackalem.catalog.routes

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.plugins.statuspages.*
import io.ktor.server.response.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kz.hackalem.catalog.service.CatalogError
import kz.hackalem.catalog.service.CatalogException

fun Application.installCatalogErrors() {
    install(StatusPages) {
        exception<CatalogException> { call, cause ->
            call.application.log.warn("Catalog request failed: {}", cause.error.name)
            call.respondError(cause.error.httpStatus(), cause.error.name, cause.error.publicMessage)
        }
        exception<Throwable> { call, cause ->
            if (cause is CancellationException) throw cause
            call.application.log.error("Catalog request failed: INTERNAL_ERROR")
            // Never serialize/log exception text, upstream bodies or Authorization headers.
            call.respondError(HttpStatusCode.InternalServerError, "INTERNAL_ERROR", CatalogError.INTERNAL_ERROR.publicMessage)
        }
        status(HttpStatusCode.NotFound) { call, status ->
            call.respondError(status, "ROUTE_NOT_FOUND", "Route not found")
        }
        status(HttpStatusCode.MethodNotAllowed) { call, status ->
            call.respondError(status, "METHOD_NOT_ALLOWED", "Method not allowed")
        }
    }
}

private fun CatalogError.httpStatus(): HttpStatusCode = when (this) {
    CatalogError.INVALID_PRODUCT_ID, CatalogError.INVALID_SEARCH_QUERY -> HttpStatusCode.BadRequest
    CatalogError.INVALID_AI_QUERY -> HttpStatusCode.BadRequest
    CatalogError.AI_REQUEST_TOO_LARGE -> HttpStatusCode.PayloadTooLarge
    CatalogError.AI_BUSY -> HttpStatusCode.TooManyRequests
    CatalogError.AI_DISABLED, CatalogError.AI_UNAVAILABLE -> HttpStatusCode.ServiceUnavailable
    CatalogError.AI_INVALID_RESPONSE -> HttpStatusCode.BadGateway
    CatalogError.PRODUCT_NOT_FOUND, CatalogError.PRODUCT_NOT_IN_LOADED_SAMPLE -> HttpStatusCode.NotFound
    CatalogError.UPSTREAM_INVALID_RESPONSE -> HttpStatusCode.BadGateway
    CatalogError.ANALOGS_NOT_IMPLEMENTED -> HttpStatusCode.NotImplemented
    CatalogError.ANALOGS_INSUFFICIENT_DATA -> HttpStatusCode.UnprocessableEntity
    CatalogError.INTERNAL_ERROR -> HttpStatusCode.InternalServerError
    CatalogError.CATALOG_NOT_READY, CatalogError.UPSTREAM_UNAVAILABLE, CatalogError.ANALOGS_UNAVAILABLE -> HttpStatusCode.ServiceUnavailable
}

private suspend fun ApplicationCall.respondError(status: HttpStatusCode, code: String, message: String) {
    response.headers.append(HttpHeaders.CacheControl, "no-store")
    val body = buildJsonObject {
        put("error", buildJsonObject {
            put("code", code)
            put("message", message)
        })
    }
    respondText(body.toString(), ContentType.Application.Json, status)
}
