package kz.hackalem.catalog

import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*
import io.ktor.server.routing.*
import kz.hackalem.catalog.routes.catalogRoutes
import kz.hackalem.catalog.routes.installCatalogErrors
import kz.hackalem.catalog.service.CatalogService
import kz.hackalem.catalog.ekt.CatalogSources
import kz.hackalem.catalog.assistant.AiSearchService
import kz.hackalem.catalog.routes.assistedSearchRoutes
import io.ktor.http.*
import io.ktor.server.response.*
import io.ktor.server.plugins.cors.routing.*
import java.net.URI

fun main() {
    val host = System.getenv("CATALOG_HOST") ?: "127.0.0.1"
    val rawPort = System.getenv("PORT") ?: System.getenv("CATALOG_PORT") ?: "8080"
    val port = rawPort.toIntOrNull()?.takeIf { it in 1..65535 }
        ?: error("PORT / CATALOG_PORT must be an integer from 1 to 65535")
    embeddedServer(Netty, host = host, port = port) { catalogModule() }.start(wait = true)
}

fun Application.catalogModule(
    service: CatalogService = CatalogService(CatalogSources.fromEnvironment()),
    assistant: AiSearchService = AiSearchService.fromEnvironment(service),
    corsOrigins: List<String> = parseCorsOrigins(System.getenv("CATALOG_CORS_ORIGINS")),
) {
    installCatalogErrors()
    if (corsOrigins.isNotEmpty()) install(CORS) {
        corsOrigins.forEach { origin ->
            val uri = URI(origin)
            allowHost(uri.rawAuthority, schemes = listOf(uri.scheme))
        }
        allowMethod(HttpMethod.Get)
        allowMethod(HttpMethod.Post)
        allowHeader(HttpHeaders.ContentType)
        allowCredentials = false
    }
    log.info("Catalog service initialized")
    routing {
        get("/health/live") { call.respondText("{\"status\":\"live\"}", ContentType.Application.Json) }
        get("/health/ready") {
            call.response.headers.append(HttpHeaders.CacheControl, "no-store")
            call.respondText("{\"status\":\"${if (service.isConfigured) "ready" else "not_ready"}\"}",
                ContentType.Application.Json,
                if (service.isConfigured) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable)
        }
        catalogRoutes(service)
        assistedSearchRoutes(assistant)
    }
}

internal fun parseCorsOrigins(raw: String?): List<String> = raw.orEmpty().split(',')
    .map { it.trim() }.filter { it.isNotEmpty() }.onEach { origin ->
        val uri = try { URI(origin) } catch (_: Exception) { null }
        require(uri != null && uri.scheme in listOf("https", "http") && !uri.host.isNullOrBlank() &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            uri.rawPath.isNullOrEmpty() && uri.port in -1..65535 && uri.port != 0 && '*' !in origin) {
            "CATALOG_CORS_ORIGINS must contain comma-separated HTTP(S) origins without paths or credentials"
        }
    }
