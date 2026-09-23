package kz.hackalem.catalog.ekt

import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kz.hackalem.catalog.model.*
import kz.hackalem.catalog.normalization.EktListNormalizer

/** Reusable #2 integration boundary: consumers see only normalized products and provenance. */
fun interface NormalizedCatalog { suspend fun snapshot(): CatalogSnapshot }

internal data class LoadedCatalog(val products: List<Product>, val pages: List<Int>)

/** Bounded scan: count/short pages do not establish completeness of the upstream catalog. */
internal fun loadCatalogPages(
    maxProducts: Int,
    maxPages: Int,
    fetch: (Int) -> kotlinx.serialization.json.JsonElement,
): LoadedCatalog {
    require(maxProducts > 0 && maxPages > 0)
    val products = linkedMapOf<String, Product>()
    val pages = mutableListOf<Int>()
    for (page in 1..maxPages) {
        val batch = EktListNormalizer.normalize(fetch(page), maxProducts - products.size, page)
        pages.add(page)
        if (batch.isEmpty()) break
        // Repeated/overlapping pages make the scan unreliable; do not cache a misleading success.
        if (batch.any { it.id in products }) throw EktException.InvalidResponse()
        batch.forEach { products[it.id] = it }
        if (products.size >= maxProducts) break
    }
    return LoadedCatalog(products.values.toList(), pages)
}

internal class CachedEktCatalog(
    private val source: suspend () -> LoadedCatalog,
    private val mode: SourceMode,
    private val ttl: Duration = Duration.ofSeconds(60),
    private val clock: Clock = Clock.systemUTC(),
    private val timeoutMs: Long = 35_000,
) : NormalizedCatalog {
    private val mutex = Mutex()
    private var cached: CatalogSnapshot? = null
    private var refreshAt: Instant = Instant.MIN

    override suspend fun snapshot(): CatalogSnapshot = mutex.withLock {
        if (clock.instant().isBefore(refreshAt)) return@withLock cached!!
        val loaded = try { withTimeout(timeoutMs) { source() } }
        catch (_: TimeoutCancellationException) { throw EktException.Timeout() }
        val now = clock.instant()
        val next = now.plus(ttl)
        val metadata = CatalogMetadata(mode, loaded.pages.first(), loaded.products.size, if (mode == SourceMode.LIVE) now else null,
            now, if (mode == SourceMode.LIVE) next else null, loaded.pages)
        // Failed refresh never replaces/returns old data as current.
        CatalogSnapshot(loaded.products, metadata).also { cached = it; refreshAt = next }
    }
}

object CatalogSources {
    fun fromEnvironment(environment: Map<String, String> = System.getenv()): NormalizedCatalog? {
        fun setting(name: String, fallback: Int, range: IntRange): Int {
            val raw = environment[name] ?: return fallback
            return raw.toIntOrNull()?.takeIf { it in range } ?: throw EktException.Configuration("Invalid catalog limit")
        }
        val mode = environment["CATALOG_SOURCE"] ?: "disabled"
        if (mode == "disabled") return null
        val limit = setting("CATALOG_MAX_PRODUCTS", 100, 1..1000)
        val maxPages = setting("CATALOG_MAX_PAGES", 10, 1..100)
        val ttl = Duration.ofSeconds(setting("CATALOG_CACHE_TTL_SECONDS", 60, 1..3600).toLong())
        val timeout = setting("CATALOG_LOAD_TIMEOUT_MS", 35000, 1..120000).toLong()
        return when (mode) {
            "live" -> {
                val client = EktRawClient(EktConfig.fromEnvironment(environment))
                CachedEktCatalog({ runInterruptible(Dispatchers.IO) { loadCatalogPages(limit, maxPages, client::listProducts) } }, SourceMode.LIVE, ttl, timeoutMs = timeout)
            }
            "snapshot" -> {
                val file = environment["CATALOG_SNAPSHOT_PATH"]?.takeIf { it.isNotBlank() }
                    ?: throw EktException.Configuration("CATALOG_SNAPSHOT_PATH is required")
                val path = try { Path.of(file) } catch (_: Exception) { throw EktException.Configuration("Invalid snapshot path") }
                CachedEktCatalog({ runInterruptible(Dispatchers.IO) { readSnapshot(path, limit) } }, SourceMode.SNAPSHOT, ttl, timeoutMs = timeout)
            }
            else -> throw EktException.Configuration("Invalid CATALOG_SOURCE")
        }
    }

    private fun readSnapshot(path: Path, limit: Int): LoadedCatalog {
        val bytes = try { Files.newInputStream(path).use { it.readNBytes(JdkEktTransport.MAX_RESPONSE_BYTES + 1) } }
        catch (_: IOException) { throw EktException.Unavailable() }
        catch (_: SecurityException) { throw EktException.Unavailable() }
        if (bytes.size > JdkEktTransport.MAX_RESPONSE_BYTES) throw EktException.InvalidResponse()
        return try {
            val raw = Json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true))
            val products = EktListNormalizer.normalize(raw, limit)
            val page = (raw as kotlinx.serialization.json.JsonObject).getValue("page").toString().toInt()
            LoadedCatalog(products, listOf(page))
        }
        catch (error: EktException) { throw error }
        catch (_: Exception) { throw EktException.InvalidResponse() }
    }
}
