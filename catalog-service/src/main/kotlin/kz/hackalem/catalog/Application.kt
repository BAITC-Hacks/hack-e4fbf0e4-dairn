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

fun main() {
    val host = System.getenv("CATALOG_HOST") ?: "127.0.0.1"
    val rawPort = System.getenv("CATALOG_PORT") ?: "8080"
    val port = rawPort.toIntOrNull()?.takeIf { it in 1..65535 }
        ?: error("CATALOG_PORT must be an integer from 1 to 65535")
    embeddedServer(Netty, host = host, port = port) { catalogModule() }.start(wait = true)
}

fun Application.catalogModule(
    service: CatalogService = CatalogService(CatalogSources.fromEnvironment()),
    assistant: AiSearchService = AiSearchService.fromEnvironment(service),
) {
    installCatalogErrors()
    routing { catalogRoutes(service); assistedSearchRoutes(assistant) }
}
