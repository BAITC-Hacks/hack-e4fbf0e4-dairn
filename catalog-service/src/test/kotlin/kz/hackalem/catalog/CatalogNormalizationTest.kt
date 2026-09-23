package kz.hackalem.catalog

import java.math.BigDecimal
import java.time.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import kz.hackalem.catalog.ekt.*
import kz.hackalem.catalog.model.*
import kz.hackalem.catalog.normalization.EktListNormalizer
import kotlin.test.*

class CatalogNormalizationTest {
    private val fixture = javaClass.getResource("/ekt/products-page-1.json")!!
    private fun raw() = Json.parseToJsonElement(fixture.readText()).jsonObject
    private fun products() = EktListNormalizer.normalize(raw(), 100)

    @Test fun `observed EKT list maps identity decimals and unknown stock without guessing`() {
        val products = products()
        assertEquals(20, products.size)
        val first = products.first()
        assertEquals("45357", first.id)
        assertEquals("ярп4520", first.sku)
        assertEquals(BigDecimal("1810"), first.price!!.amount)
        assertNull(first.price.currency)
        assertEquals("310100080_", products.first { it.id == "25397" }.sku)
        assertTrue(products.first { it.id == "25397" }.images.isEmpty())
        assertTrue(products.all { it.availability == Availability(AvailabilityStatus.UNKNOWN, null) })
    }

    @Test fun `missing price is distinct from zero and decimals retain precision`() {
        fun product(price: JsonElement?) = buildJsonObject { put("id", 1); put("name", "Test"); if (price != null) put("price", price); put("offers", buildJsonArray { add(buildJsonObject { put("quantity", 999) }) }) }
        for ((price, expected) in listOf(null to null, JsonNull to null, JsonPrimitive(0) to "0", Json.parseToJsonElement("123456789.123456789") to "123456789.123456789")) {
            val result = EktListNormalizer.normalize(page(product(price)), 100).single()
            assertEquals(expected, result.price?.amount?.toPlainString())
            assertEquals(AvailabilityStatus.UNKNOWN, result.availability.status)
        }
    }

    @Test fun `malformed records and duplicate ids are explicit errors`() {
        val good = raw().getValue("items").jsonArray.first().jsonObject
        for (bad in listOf(
            JsonObject(good + ("id" to JsonPrimitive("45357"))),
            JsonObject(good + ("price" to JsonPrimitive("1810"))),
            JsonObject(good + ("image" to JsonPrimitive("javascript:alert(1)"))),
            JsonObject(good + ("url" to JsonPrimitive("https://user:password@example.com"))),
            JsonObject(good - "name"),
        )) assertFailsWith<EktException.InvalidResponse> { EktListNormalizer.normalize(page(bad), 100) }
        assertFailsWith<EktException.InvalidResponse> { EktListNormalizer.normalize(page(good, good), 100) }
        assertEquals(3, EktListNormalizer.normalize(raw(), 3).size)
    }

    @Test fun `cache coalesces concurrent loads and never serves expired data after failure`() = runBlocking {
        val clock = MutableClock()
        var calls = 0
        var broken = false
        val catalog = CachedEktCatalog({ calls++; if (broken) throw EktException.Unavailable(); delay(10); products() }, SourceMode.LIVE, Duration.ofSeconds(60), clock)
        coroutineScope { (1..10).map { async { catalog.snapshot() } }.awaitAll() }
        assertEquals(1, calls)
        assertEquals(clock.instant(), catalog.snapshot().metadata.observedAt)
        clock.now = clock.now.plusSeconds(61)
        broken = true
        assertFailsWith<EktException.Unavailable> { catalog.snapshot() }
        assertEquals(2, calls)
        broken = false
        assertEquals(clock.instant(), catalog.snapshot().metadata.observedAt)
        assertEquals(3, calls)
    }

    @Test fun `load deadline and disabled configuration are explicit`() = runBlocking {
        val catalog = CachedEktCatalog({ delay(1000); products() }, SourceMode.LIVE, timeoutMs = 10)
        assertFailsWith<EktException.Timeout> { catalog.snapshot() }
        assertNull(CatalogSources.fromEnvironment(emptyMap()))
        assertFailsWith<EktException.Configuration> { CatalogSources.fromEnvironment(mapOf("CATALOG_SOURCE" to "snapshot")) }
        assertFailsWith<EktException.Configuration> { CatalogSources.fromEnvironment(mapOf("CATALOG_SOURCE" to "live", "CATALOG_MAX_PRODUCTS" to "0")) }
        Unit
    }

    private fun page(vararg products: JsonObject) = buildJsonObject {
        put("page", 1); put("per_page", 20); put("count", products.size); put("items", JsonArray(products.toList()))
    }
    private class MutableClock(var now: Instant = Instant.parse("2026-09-23T00:00:00Z")) : Clock() {
        override fun instant() = now
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = this
    }
}
