package kz.hackalem.catalog.routes

import kotlinx.serialization.json.*
import kz.hackalem.catalog.model.*

/** Explicit normalized HTTP projection. Raw upstream JSON is never serializable through this API. */
internal fun ProductResponse.json() = buildJsonObject { put("product", product.json()); put("metadata", metadata.json()) }
internal fun SearchResponse.json() = buildJsonObject { put("items", JsonArray(items.map { it.json() })); put("metadata", metadata.json()) }
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
}
private fun Availability.json() = buildJsonObject {
    put("status", status.name); put("quantity", quantity?.toPlainString()?.let(::JsonPrimitive) ?: JsonNull)
}
internal fun CatalogMetadata.json() = buildJsonObject {
    put("source", "EKT_PRODUCT_LIST"); put("mode", mode.name)
    put("coverage", "PARTIAL"); put("pages", buildJsonArray { add(page) })
    put("loadedProducts", loadedProducts); put("totalProducts", JsonNull)
    put("observedAt", observedAt?.toString()?.let(::JsonPrimitive) ?: JsonNull)
    put("loadedAt", loadedAt.toString())
    put("expiresAt", expiresAt?.toString()?.let(::JsonPrimitive) ?: JsonNull)
    put("freshness", if (mode == SourceMode.SNAPSHOT) "UNKNOWN" else "RECENTLY_FETCHED")
    put("detailLevel", "LIST_SUMMARY")
}
