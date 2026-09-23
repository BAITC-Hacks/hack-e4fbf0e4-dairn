package kz.hackalem.catalog.service

import java.util.Locale
import kz.hackalem.catalog.ekt.*
import kz.hackalem.catalog.model.*

enum class CatalogError(val publicMessage: String) {
    INVALID_PRODUCT_ID("Product ID must contain 1 to 256 non-whitespace characters"),
    INVALID_SEARCH_QUERY("Provide exactly one query containing 1 to 200 characters"),
    PRODUCT_NOT_FOUND("Product not found"),
    PRODUCT_NOT_IN_LOADED_SAMPLE("Product is not in the loaded sample; existence in the full catalog is unknown"),
    CATALOG_NOT_READY("Normalized catalog adapter is not integrated yet"),
    UPSTREAM_UNAVAILABLE("Catalog source is unavailable"),
    UPSTREAM_INVALID_RESPONSE("Catalog source returned unusable data"),
    ANALOGS_NOT_IMPLEMENTED("Analog selection is not implemented yet"),
    ANALOGS_INSUFFICIENT_DATA("Insufficient verified data for analog selection"),
    ANALOGS_UNAVAILABLE("Analog selection is unavailable"),
    INTERNAL_ERROR("Internal server error"),
    INVALID_AI_QUERY("Expected a JSON object with text containing 1 to 2000 characters"),
    AI_REQUEST_TOO_LARGE("Request exceeds 8192 bytes"),
    AI_DISABLED("AI search is disabled"),
    AI_BUSY("AI search is busy; retry later"),
    AI_UNAVAILABLE("AI search provider is unavailable or not configured"),
    AI_INVALID_RESPONSE("AI response could not be validated"),
}

class CatalogException(val error: CatalogError) : RuntimeException(error.publicMessage)

/** HTTP-independent validation. IDs are opaque: no unverified numeric EKT assumption. */
object CatalogInput {
    fun productId(value: String?): String {
        if (value.isNullOrEmpty() || value.length > 256 || value.any { it.isWhitespace() || it.isISOControl() }) {
            throw CatalogException(CatalogError.INVALID_PRODUCT_ID)
        }
        return value
    }

    fun searchQuery(values: List<String>?): String {
        val query = values?.singleOrNull()?.trim()
        if (query.isNullOrEmpty() || query.length > 200 || query.any { it.isISOControl() }) {
            throw CatalogException(CatalogError.INVALID_SEARCH_QUERY)
        }
        return query
    }
}

/** Read-only service consumes normalized data; it never knows EKT field names. */
class CatalogService(private val catalog: NormalizedCatalog? = null) {
    val isConfigured: Boolean get() = catalog != null

    suspend fun product(id: String?): ProductResponse {
        val validated = CatalogInput.productId(id)
        try {
            catalog?.detail(validated)?.let { return it }
        } catch (error: EktException) {
            throw CatalogException(when (error) {
                is EktException.NotFound -> CatalogError.PRODUCT_NOT_FOUND
                is EktException.InvalidResponse -> CatalogError.UPSTREAM_INVALID_RESPONSE
                is EktException.Configuration -> CatalogError.CATALOG_NOT_READY
                else -> CatalogError.UPSTREAM_UNAVAILABLE
            })
        }
        val snapshot = snapshot()
        val product = snapshot.products.firstOrNull { it.id == validated }
            ?: throw CatalogException(CatalogError.PRODUCT_NOT_IN_LOADED_SAMPLE)
        return ProductResponse(product, snapshot.metadata)
    }

    suspend fun search(queries: List<String>?): SearchResponse {
        val query = CatalogInput.searchQuery(queries).lowercase(Locale.ROOT)
        val snapshot = snapshot()
        val items = snapshot.products.filter {
            it.sku?.lowercase(Locale.ROOT)?.contains(query) == true || it.name.lowercase(Locale.ROOT).contains(query) ||
                CatalogSearchAliases.matches(it.name, query)
        }.sortedBy { if (it.sku?.lowercase(Locale.ROOT) == query) 0 else 1 }
        return SearchResponse(items, snapshot.metadata)
    }

    suspend fun availability(id: String?): AvailabilityResponse {
        val response = product(id)
        return AvailabilityResponse(response.product.id, response.product.availability, response.metadata)
    }

    suspend fun analogs(id: String?): Nothing {
        CatalogInput.productId(id)
        if (catalog != null) {
            product(id)
            // Observed list has neither verified stock nor compatibility characteristics.
            throw CatalogException(CatalogError.ANALOGS_INSUFFICIENT_DATA)
        }
        throw CatalogException(CatalogError.ANALOGS_NOT_IMPLEMENTED)
    }

    internal suspend fun snapshot(): CatalogSnapshot = try {
        (catalog ?: throw CatalogException(CatalogError.CATALOG_NOT_READY)).snapshot()
    } catch (error: EktException) {
        throw CatalogException(when (error) {
            is EktException.InvalidResponse -> CatalogError.UPSTREAM_INVALID_RESPONSE
            is EktException.Configuration -> CatalogError.CATALOG_NOT_READY
            // A list endpoint 404 says nothing about a particular product's existence.
            else -> CatalogError.UPSTREAM_UNAVAILABLE
        })
    }
}
