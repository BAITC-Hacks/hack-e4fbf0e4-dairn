package kz.hackalem.catalog.service

import java.util.Locale

/** Search hints only: these patterns never assign product categories or compatibility facts. */
internal object CatalogSearchAliases {
    private val breakerQueries = setOf("автомат", "автоматы", "автоматический выключатель", "автоматические выключатели")
    private val differentialQueries = setOf("дифавтомат", "дифавтоматы", "дифференциальный автомат", "дифференциальные автоматы")
    // Require the observed DRX model designation; standalone АВ is too ambiguous.
    private val drxBreaker = Regex("(?<![\\p{L}\\p{N}])ав\\s+drx\\d+(?![\\p{L}\\p{N}])")
    private val differentialBreaker = Regex("(?<![\\p{L}\\p{N}])диф\\.\\s*авт\\.(?![\\p{L}])")
    private val whitespace = Regex("\\s+")

    fun matches(name: String, query: String): Boolean {
        val normalizedQuery = query.lowercase(Locale.ROOT).trim().replace(whitespace, " ")
        val normalizedName = name.lowercase(Locale.ROOT)
        return when (normalizedQuery) {
            in breakerQueries -> drxBreaker.containsMatchIn(normalizedName) || differentialBreaker.containsMatchIn(normalizedName)
            in differentialQueries -> differentialBreaker.containsMatchIn(normalizedName)
            else -> false
        }
    }
}
