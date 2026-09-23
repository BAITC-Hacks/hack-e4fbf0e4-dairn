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

internal class CachedEktCatalog(
    private val source: suspend () -> List<Product>,
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
        val products = try { withTimeout(timeoutMs) { source() } }
        catch (_: TimeoutCancellationException) { throw EktException.Timeout() }
        val now = clock.instant()
        val next = now.plus(ttl)
        val metadata = CatalogMetadata(mode, 1, products.size, if (mode == SourceMode.LIVE) now else null,
            now, if (mode == SourceMode.LIVE) next else null)
        // Failed refresh never replaces/returns old data as current.
        CatalogSnapshot(products, metadata).also { cached = it; refreshAt = next }
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
        val ttl = Duration.ofSeconds(setting("CATALOG_CACHE_TTL_SECONDS", 60, 1..3600).toLong())
        val timeout = setting("CATALOG_LOAD_TIMEOUT_MS", 35000, 1..120000).toLong()
        return when (mode) {
            "live" -> {
                val client = EktRawClient(EktConfig.fromEnvironment(environment))
                CachedEktCatalog({ runInterruptible(Dispatchers.IO) { EktListNormalizer.normalize(client.listProducts(1), limit) } }, SourceMode.LIVE, ttl, timeoutMs = timeout)
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

    private fun readSnapshot(path: Path, limit: Int): List<Product> {
        val bytes = try { Files.newInputStream(path).use { it.readNBytes(JdkEktTransport.MAX_RESPONSE_BYTES + 1) } }
        catch (_: IOException) { throw EktException.Unavailable() }
        catch (_: SecurityException) { throw EktException.Unavailable() }
        if (bytes.size > JdkEktTransport.MAX_RESPONSE_BYTES) throw EktException.InvalidResponse()
        return try { EktListNormalizer.normalize(Json.parseToJsonElement(bytes.decodeToString(throwOnInvalidSequence = true)), limit) }
        catch (error: EktException) { throw error }
        catch (_: Exception) { throw EktException.InvalidResponse() }
    }
}
