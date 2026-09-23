package kz.hackalem.catalog.model

import java.math.BigDecimal
import java.time.Instant

/** Shared normalized contract. No EKT JSON or AI-generated facts cross this boundary. */
data class Product(
    val id: String,
    val sku: String?,
    val name: String,
    val price: Price?,
    val images: List<String>,
    val pageUrl: String?,
    val availability: Availability = Availability(AvailabilityStatus.UNKNOWN, null),
    val description: String? = null,
    val stock: List<WarehouseStock> = emptyList(),
    val attributes: Map<String, String> = emptyMap(),
)
data class WarehouseStock(val id: String, val name: String, val quantity: BigDecimal?)
data class Price(val amount: BigDecimal, val currency: String? = null)
enum class AvailabilityStatus { AVAILABLE, UNAVAILABLE, UNKNOWN }
data class Availability(val status: AvailabilityStatus, val quantity: BigDecimal?)

enum class SourceMode { LIVE, SNAPSHOT }
data class CatalogMetadata(
    val mode: SourceMode,
    val page: Int,
    val loadedProducts: Int,
    val observedAt: Instant?,
    val loadedAt: Instant,
    val expiresAt: Instant?,
    val pages: List<Int> = listOf(page),
    val source: String = "EKT_PRODUCT_LIST",
    val detailLevel: String = "LIST_SUMMARY",
)
data class CatalogSnapshot(val products: List<Product>, val metadata: CatalogMetadata)
data class ProductResponse(val product: Product, val metadata: CatalogMetadata)
data class SearchResponse(val items: List<Product>, val metadata: CatalogMetadata)
data class AvailabilityResponse(val productId: String, val availability: Availability, val metadata: CatalogMetadata)
