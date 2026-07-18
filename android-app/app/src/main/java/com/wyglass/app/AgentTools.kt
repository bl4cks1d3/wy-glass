package com.wyglass.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Free/keyless data-source lookups for the Groq function-calling agent — a straight Kotlin
 * port of the PC side's browser_tools.py fallback chain (same sources, same order, same
 * keyword gating), minus the Playwright/DuckDuckGo browser-scrape last resort (no headless
 * browser on Android; DuckDuckGo's HTML endpoint was already unreliable on the PC side too).
 */
object AgentTools {

    private const val TAG = "WyGlass"

    private fun httpGet(urlStr: String, headers: Map<String, String> = emptyMap()): String? {
        return try {
            val conn = URL(urlStr).openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android) WyGlass")
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }
            conn.disconnect()
            if (code in 200..299) body else null
        } catch (e: Exception) {
            android.util.Log.d(TAG, "httpGet failed: $urlStr — ${e.message}")
            null
        }
    }

    private val weatherWords = listOf("tempo", "temperatura", "clima", "previsao", "previsão", "chuva", "graus")

    private fun searchWeather(query: String): String? {
        val q = query.lowercase()
        if (weatherWords.none { q.contains(it) }) return null
        var location = query
        listOf(
            "qual a", "qual e a", "busque a", "pesquise a", "temperatura no", "temperatura em",
            "tempo em", "tempo no", "clima em", "clima no", "previsao do tempo em",
            "previsao do tempo no", "previsao para", "estado de", "na cidade de", "?"
        ).forEach { filler -> location = Regex(Regex.escape(filler), RegexOption.IGNORE_CASE).replace(location, "") }
        location = location.trim(' ', ',', '.')
        val encoded = URLEncoder.encode(location, "UTF-8")
        val body = httpGet("https://wttr.in/$encoded?format=3") ?: return null
        val text = body.trim()
        if (text.isEmpty() || text.contains("Unknown location")) return null
        return text
    }

    private val currencyCodes = mapOf(
        "dolar" to "USD", "dólar" to "USD", "euro" to "EUR", "libra" to "GBP",
        "peso" to "ARS", "iene" to "JPY", "yene" to "JPY", "yuan" to "CNY", "franco" to "CHF",
    )

    private fun searchCurrency(query: String): String? {
        val q = query.lowercase()
        val gate = listOf("cambio", "câmbio", "cotacao", "cotação", "conversao de moeda") + currencyCodes.keys
        if (gate.none { q.contains(it) }) return null
        val target = currencyCodes.entries.firstOrNull { q.contains(it.key) }?.value ?: "USD"
        val body = httpGet("https://api.frankfurter.app/latest?from=$target&to=BRL") ?: return null
        return try {
            val json = JSONObject(body)
            val rate = json.getJSONObject("rates").getDouble("BRL")
            val date = json.getString("date")
            "1 $target = ${"%.4f".format(rate)} BRL (taxa de $date, fonte: Banco Central Europeu)"
        } catch (e: Exception) {
            null
        }
    }

    private val cryptoCoins = mapOf(
        "bitcoin" to "bitcoin", "btc" to "bitcoin",
        "ethereum" to "ethereum", "eth" to "ethereum",
        "dogecoin" to "dogecoin", "doge" to "dogecoin",
        "solana" to "solana", "sol" to "solana",
        "cardano" to "cardano", "ada" to "cardano",
        "ripple" to "ripple", "xrp" to "ripple",
        "criptomoeda" to "bitcoin", "cripto" to "bitcoin",
    )

    private fun searchCrypto(query: String): String? {
        val q = query.lowercase()
        val coinId = cryptoCoins.entries.firstOrNull { q.contains(it.key) }?.value ?: return null
        val body = httpGet(
            "https://api.coingecko.com/api/v3/simple/price?ids=$coinId&vs_currencies=brl,usd&include_24hr_change=true"
        ) ?: return null
        return try {
            val data = JSONObject(body).getJSONObject(coinId)
            val brl = data.optDouble("brl", 0.0)
            val usd = data.optDouble("usd", 0.0)
            val change = data.optDouble("brl_24h_change", 0.0)
            val label = coinId.replaceFirstChar { it.uppercase() }
            "$label: R$ ${"%,.2f".format(brl)} / US$ ${"%,.2f".format(usd)} (variacao 24h: ${"%+.2f".format(change)}%)"
        } catch (e: Exception) {
            null
        }
    }

    private fun searchHoliday(query: String): String? {
        if (!query.lowercase().contains("feriado")) return null
        val body = httpGet("https://date.nager.at/api/v3/NextPublicHolidays/BR") ?: return null
        return try {
            val arr = org.json.JSONArray(body)
            if (arr.length() == 0) return null
            val items = (0 until minOf(3, arr.length())).map {
                val h = arr.getJSONObject(it)
                "${h.getString("date")}: ${h.getString("localName")}"
            }
            items.joinToString("; ")
        } catch (e: Exception) {
            null
        }
    }

    private fun searchTavily(query: String, apiKey: String): String? {
        if (apiKey.isBlank()) return null
        return try {
            val payload = JSONObject().apply {
                put("api_key", apiKey)
                put("query", query)
                put("max_results", 3)
                put("include_answer", true)
            }
            val conn = URL("https://api.tavily.com/search").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }
            conn.disconnect()
            if (code !in 200..299 || body == null) return null
            val json = JSONObject(body)
            val answer = json.optString("answer", "")
            val results = json.optJSONArray("results")
            val sb = StringBuilder(answer)
            if (results != null && results.length() > 0) {
                sb.append("\n\n")
                for (i in 0 until minOf(3, results.length())) {
                    val r = results.getJSONObject(i)
                    sb.append("- ${r.optString("title", "")}: ${r.optString("content", "").take(300)}\n")
                }
            }
            sb.toString().trim().ifBlank { null }
        } catch (e: Exception) {
            null
        }
    }

    private fun searchWikipedia(query: String, lang: String = "pt"): String? {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val searchBody = httpGet(
            "https://$lang.wikipedia.org/w/api.php?action=query&list=search&srsearch=$encoded&format=json&srlimit=1"
        ) ?: return null
        return try {
            val hits = JSONObject(searchBody).getJSONObject("query").getJSONArray("search")
            if (hits.length() == 0) return null
            val title = hits.getJSONObject(0).getString("title")
            val encodedTitle = URLEncoder.encode(title, "UTF-8")
            val summaryBody = httpGet("https://$lang.wikipedia.org/api/rest_v1/page/summary/$encodedTitle") ?: return null
            JSONObject(summaryBody).optString("extract", "").ifBlank { null }
        } catch (e: Exception) {
            null
        }
    }

    data class SearchResult(val content: String, val liveData: Boolean)

    /**
     * Tries dedicated live-data sources first (weather/currency/crypto/holidays — keyword
     * gated, only fire for matching queries), then Tavily (if configured), then Wikipedia.
     * No headless-browser last resort on Android — unlike the PC side, there's nowhere left
     * to fall back to if all of these miss. liveData=true marks results from the dedicated
     * sources as already speakable as-is, so the caller can skip a second LLM round-trip
     * just to reword them (same latency optimization as the PC side's smart_agent.py).
     */
    fun search(query: String, tavilyApiKey: String): SearchResult {
        for (dedicated in listOf(::searchWeather, ::searchCurrency, ::searchCrypto, ::searchHoliday)) {
            dedicated(query)?.let { return SearchResult(it, liveData = true) }
        }
        searchTavily(query, tavilyApiKey)?.let { return SearchResult(it, liveData = false) }
        searchWikipedia(query)?.let { return SearchResult(it, liveData = false) }
        return SearchResult("Busca nao encontrou resultado pra \"$query\".", liveData = false)
    }

    fun openUrl(context: android.content.Context, url: String): String {
        return try {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
            intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Aberto: $url"
        } catch (e: Exception) {
            "Nao foi possivel abrir $url: ${e.message}"
        }
    }
}
