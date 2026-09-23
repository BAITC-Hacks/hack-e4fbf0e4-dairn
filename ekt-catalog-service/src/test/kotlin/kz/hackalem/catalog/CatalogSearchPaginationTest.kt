package kz.hackalem.catalog

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.server.testing.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import kz.hackalem.catalog.ekt.*
import kz.hackalem.catalog.model.*
import kz.hackalem.catalog.normalization.EktListNormalizer
import kz.hackalem.catalog.service.CatalogService
import kotlin.test.*

class CatalogSearchPaginationTest {
    private fun product(id: Int, name: String, sku: String = "sku-$id") = buildJsonObject {
        put("id", id); put("name", name); put("article", sku)
    }
    private fun page(number: Int, vararg products: JsonObject) = buildJsonObject {
        put("page", number); put("per_page", 20); put("count", products.size)
        put("items", JsonArray(products.toList()))
    }

    @Test fun `search finds second page and explains partial results over HTTP`() = testApplication {
        val requested = mutableListOf<Int>()
        val catalog = CachedEktCatalog({ loadCatalogPages(100, 10) { number ->
            requested.add(number)
            when (number) {
                1 -> page(1, product(1, "Лампа"))
                2 -> page(2, product(2, "027004 АВ DRX125 MT 3ф 40А"))
                else -> page(number)
            }
        } }, SourceMode.LIVE)
        application { catalogModule(CatalogService(catalog)) }
        val response = client.get("/api/catalog/products") { parameter("query", "автомат") }
        assertEquals(200, response.status.value)
        val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
        assertEquals("2", body.getValue("items").jsonArray.single().jsonObject.getValue("id").jsonPrimitive.content)
        assertEquals(JsonPrimitive(1), body["matchedProducts"])
        val metadata = body.getValue("metadata").jsonObject
        assertEquals(JsonPrimitive(2), metadata["loadedProducts"])
        assertEquals(JsonArray(listOf(1, 2, 3).map(::JsonPrimitive)), metadata["pages"])
        assertEquals(JsonPrimitive("PARTIAL"), metadata["coverage"])
        val miss = Json.parseToJsonElement(client.get("/api/catalog/products?query=absent").bodyAsText()).jsonObject
        assertEquals(JsonPrimitive(0), miss["matchedProducts"])
        assertTrue(miss.getValue("items").jsonArray.isEmpty())
        assertEquals("PARTIAL_CATALOG_SEARCH", miss.getValue("warnings").jsonArray.single().jsonObject.getValue("code").jsonPrimitive.content)
        assertEquals(listOf(1, 2, 3), requested) // Second search uses the cached scan.
    }

    @Test fun `observed fixture matches breaker abbreviations and preserves exact SKU priority`() = runBlocking {
        val raw = Json.parseToJsonElement(javaClass.getResource("/ekt/products-page-1.json")!!.readText())
        val observed = EktListNormalizer.normalize(raw, 100)
        val extras = EktListNormalizer.normalize(page(2,
            product(100, "Кабель АВ 40А"),
            product(101, "АВ DRX125XYZ"),
            product(102, "Товар с точным артикулом", "автомат"),
        ), 100, 2)
        val service = CatalogService(CachedEktCatalog({ LoadedCatalog(observed + extras, listOf(1, 2)) }, SourceMode.SNAPSHOT))
        val result = service.search(listOf("АВТОМАТ")).items
        assertEquals(15, result.size) // 13 DRX, one differential breaker and the exact SKU.
        assertEquals("102", result.first().id)
        assertFalse(result.any { it.id in setOf("100", "101") })
        assertEquals("25397", service.search(listOf("дифавтомат")).items.single().id)
        assertEquals(14, service.search(listOf("автоматические выключатели")).items.size)
        assertEquals("45357", service.search(listOf("ЯРП4520")).items.single().id)
    }

    @Test fun `scan respects product and page budgets without extra requests`() {
        val requested = mutableListOf<Int>()
        val fetch = { number: Int -> requested.add(number); page(number, product(number * 10, "A"), product(number * 10 + 1, "B")) }
        val limited = loadCatalogPages(3, 10, fetch)
        assertEquals(3, limited.products.size)
        assertEquals(listOf(1, 2), requested)
        requested.clear()
        assertEquals(4, loadCatalogPages(100, 2, fetch).products.size)
        assertEquals(listOf(1, 2), requested)
    }

    @Test fun `wrong page repeated IDs and later source errors cannot become successful partial scans`() {
        assertFailsWith<EktException.InvalidResponse> { loadCatalogPages(100, 3) { page(1, product(1, "A")) } }
        assertFailsWith<EktException.InvalidResponse> { loadCatalogPages(100, 3) { page(it, product(1, "A")) } }
        assertFailsWith<EktException.Unavailable> { loadCatalogPages(100, 3) {
            if (it == 2) throw EktException.Unavailable()
            page(it, product(1, "A"))
        } }
        assertFailsWith<EktException.InvalidResponse> { EktListNormalizer.normalize(page(0), 100) }
        assertFailsWith<EktException.Configuration> { CatalogSources.fromEnvironment(mapOf("CATALOG_SOURCE" to "live", "CATALOG_MAX_PAGES" to "0")) }
    }
}
