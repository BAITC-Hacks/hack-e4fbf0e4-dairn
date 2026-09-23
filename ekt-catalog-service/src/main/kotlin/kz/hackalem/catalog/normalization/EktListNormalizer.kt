package kz.hackalem.catalog.normalization

import java.math.BigDecimal
import java.net.URI
import kotlinx.serialization.json.*
import kz.hackalem.catalog.ekt.EktException
import kz.hackalem.catalog.model.*

/** Mapping is based on docs/EKT_DATA.md, observed list page only; detail schema is still unknown. */
internal object EktListNormalizer {
    fun normalize(value: JsonElement, maxProducts: Int, expectedPage: Int? = null): List<Product> {
        val root = value as? JsonObject ?: invalid()
        val page = integer(root["page"]).toIntOrNull()?.takeIf { it > 0 } ?: invalid()
        if (expectedPage != null && page != expectedPage) invalid()
        integer(root["per_page"])
        integer(root["count"])
        val items = root["items"] as? JsonArray ?: invalid()
        // count is NOT interpreted as total catalog size. Never infer completeness from it.
        val products = items.take(maxProducts).map { element ->
            val row = element as? JsonObject ?: invalid()
            val id = integer(row["id"])
            val name = string(row, "name")?.takeIf { it.isNotBlank() } ?: invalid()
            val amount = when (val raw = row["price"]) {
                null, JsonNull -> null
                is JsonPrimitive -> {
                    if (raw.isString || raw.content.length > 100) invalid()
                    val number = raw.content.toBigDecimalOrNull() ?: invalid()
                    if (number.signum() < 0 || kotlin.math.abs(number.scale().toLong()) > 100) invalid()
                    number
                }
                else -> invalid()
            }
            // offers semantics are unknown, including nonempty arrays. Never derive availability.
            if (row["offers"] != null && row["offers"] !is JsonArray) invalid()
            Product(id, string(row, "article"), name, amount?.let(::Price),
                listOfNotNull(link(row, "image")), link(row, "url"))
        }
        if (products.map { it.id }.distinct().size != products.size) invalid()
        return products
    }

    private fun integer(value: JsonElement?): String {
        val primitive = value as? JsonPrimitive ?: invalid()
        if (primitive.isString || !primitive.content.matches(Regex("[0-9]{1,80}"))) invalid()
        return primitive.content.toBigInteger().toString()
    }
    private fun string(row: JsonObject, field: String): String? = when (val value = row[field]) {
        null, JsonNull -> null
        is JsonPrimitive -> if (value.isString && value.content.length <= 10000) value.content else invalid()
        else -> invalid()
    }
    private fun link(row: JsonObject, field: String): String? {
        val value = string(row, field) ?: return null
        val uri = try { URI(value) } catch (_: Exception) { invalid() }
        if (uri.scheme !in setOf("http", "https") || uri.host.isNullOrEmpty() || uri.rawUserInfo != null) invalid()
        return value
    }
    private fun invalid(): Nothing = throw EktException.InvalidResponse()
}
