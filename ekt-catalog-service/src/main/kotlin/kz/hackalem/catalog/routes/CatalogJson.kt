package kz.hackalem.catalog.routes

import kotlinx.serialization.json.*
import kz.hackalem.catalog.model.*

/** Explicit normalized HTTP projection. Raw upstream JSON is never serializable through this API. */
internal fun ProductResponse.json() = buildJsonObject { put("product", product.json()); put("metadata", metadata.json()) }
internal fun SearchResponse.json() = buildJsonObject {
    put("items", JsonArray(items.map { it.json() }))
    put("matchedProducts", items.size)
    put("warnings", buildJsonArray { add(buildJsonObject {
        put("code", "PARTIAL_CATALOG_SEARCH")
        put("message", "Search covers only loaded catalog pages; no matches does not imply absence from the full catalog")
    }) })
    put("metadata", metadata.json())
}
internal fun AvailabilityResponse.json() = buildJsonObject {
    put("productId", productId); put("availability", availability.json()); put("metadata", metadata.json())
}
internal fun Product.json() = buildJsonObject {
    put("id", id); put("sku", sku?.let(::JsonPrimitive) ?: JsonNull); put("name", name)
    put("price", price?.let { buildJsonObject {
        // Decimal string prevents precision loss in browser clients; currency is unverified.
        put("amount", it.amount.toPlainString()); put("currency", it.currency?.let(::JsonPrimitive) ?: JsonNull)
    } } ?: JsonNull)
    put("images", JsonArray(images.map(::JsonPrimitive)))
    put("pageUrl", pageUrl?.let(::JsonPrimitive) ?: JsonNull)
    put("availability", availability.json())
    put("description", description?.let(::JsonPrimitive) ?: JsonNull)
    put("stock", JsonArray(stock.map { warehouse -> buildJsonObject {
        put("warehouse_id", warehouse.id); put("warehouse_name", warehouse.name)
        put("available_quantity", warehouse.quantity?.toPlainString()?.let(::JsonPrimitive) ?: JsonNull)
    } }))
    put("attributes", buildJsonObject { attributes.forEach { (key, value) -> put(key, value) } })
    put("certificates", JsonArray(emptyList()))
}
private fun Availability.json() = buildJsonObject {
    put("status", status.name); put("quantity", quantity?.toPlainString()?.let(::JsonPrimitive) ?: JsonNull)
}
internal fun CatalogMetadata.json() = buildJsonObject {
    put("source", source); put("mode", mode.name)
    put("coverage", "PARTIAL"); put("pages", buildJsonArray { pages.forEach { add(it) } })
    put("loadedProducts", loadedProducts); put("totalProducts", JsonNull)
    put("observedAt", observedAt?.toString()?.let(::JsonPrimitive) ?: JsonNull)
    put("loadedAt", loadedAt.toString())
    put("expiresAt", expiresAt?.toString()?.let(::JsonPrimitive) ?: JsonNull)
    put("freshness", if (mode == SourceMode.SNAPSHOT) "UNKNOWN" else "RECENTLY_FETCHED")
    put("detailLevel", detailLevel)
}
