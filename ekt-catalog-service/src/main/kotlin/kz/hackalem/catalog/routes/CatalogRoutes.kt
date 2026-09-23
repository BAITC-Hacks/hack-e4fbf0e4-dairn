package kz.hackalem.catalog.routes

import io.ktor.server.routing.*
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import kz.hackalem.catalog.service.CatalogService

fun Route.catalogRoutes(service: CatalogService) {
    route("/api/catalog/products") {
        get { call.catalogJson(service.search(call.request.queryParameters.getAll("query")).json()) }
        get("/{id}") { call.catalogJson(service.product(call.parameters["id"]).json()) }
        get("/{id}/availability") { call.catalogJson(service.availability(call.parameters["id"]).json()) }
        get("/{id}/analogs") { service.analogs(call.parameters["id"]) }
    }
}

private suspend fun ApplicationCall.catalogJson(body: kotlinx.serialization.json.JsonObject) {
    response.headers.append(HttpHeaders.CacheControl, "no-store")
    respondText(body.toString(), ContentType.Application.Json)
}
