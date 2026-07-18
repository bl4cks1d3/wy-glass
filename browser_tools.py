"""
Browser tools (search/browse/open/news) via Playwright — merged in from the
former separate Open Jarvis process. Wy Glass's action functions are synchronous
(run via run_in_executor), so this uses playwright.sync_api instead of the async
API to avoid nesting event loops inside a worker thread.
"""

import re
import webbrowser

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

_playwright = None
_browser = None
_context = None

_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def _get_browser():
    global _playwright, _browser, _context
    if _browser is None:
        _playwright = sync_playwright().start()
        _browser = _playwright.chromium.launch(headless=True)  # no visible window — headless, per user request
        _context = _browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
    return _context


_EXTRACT_JS = """
    () => {
        const selectors = ['main', 'article', '[role="main"]', '.content', '#content', 'body'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.trim().length > 100) {
                return el.innerText.trim();
            }
        }
        return document.body?.innerText?.trim() || '';
    }
"""


_WEATHER_WORDS = ("tempo", "temperatura", "clima", "previsao", "previsão", "chuva", "graus")


def _looks_like_weather_query(query: str) -> bool:
    q = query.lower()
    return any(word in q for word in _WEATHER_WORDS)


def _search_weather(query: str) -> dict | None:
    """wttr.in — free, keyless, live weather. Only tried for queries that look
    weather-related; general search (DDG/Wikipedia) has no live weather data."""
    if not _looks_like_weather_query(query):
        return None
    # Strip common Portuguese weather-query filler words, keep the rest as the
    # location guess (wttr.in accepts loose place names).
    location = query
    for filler in ("qual a", "qual e a", "busque a", "pesquise a", "temperatura no",
                    "temperatura em", "tempo em", "tempo no", "clima em", "clima no",
                    "previsao do tempo em", "previsao do tempo no", "previsao para",
                    "estado de", "na cidade de", "?"):
        location = re.sub(re.escape(filler), "", location, flags=re.IGNORECASE)
    location = location.strip(" ,.")
    try:
        resp = requests.get(f"https://wttr.in/{location}", params={"format": "3"}, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        text = resp.text.strip()
        if not text or "Unknown location" in text:
            return None
        return {"title": f"Clima: {location}", "url": f"https://wttr.in/{location}", "content": text, "live_data": True}
    except Exception:
        return None


_CURRENCY_CODES = {
    "dolar": "USD", "dólar": "USD", "euro": "EUR", "libra": "GBP",
    "peso": "ARS", "iene": "JPY", "yene": "JPY", "yuan": "CNY", "franco": "CHF",
}


def _search_currency(query: str) -> dict | None:
    """Frankfurter — free, keyless, ECB daily reference exchange rates."""
    q = query.lower()
    if not any(w in q for w in ("cambio", "câmbio", "cotacao", "cotação", "conversao de moeda",
                                  *_CURRENCY_CODES.keys())):
        return None
    target = next((code for word, code in _CURRENCY_CODES.items() if word in q), "USD")
    try:
        resp = requests.get("https://api.frankfurter.app/latest",
                             params={"from": target, "to": "BRL"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        rate = data["rates"]["BRL"]
        return {
            "title": f"Cambio {target}/BRL",
            "url": "https://www.frankfurter.app/",
            "content": f"1 {target} = {rate:.4f} BRL (taxa de {data['date']}, fonte: Banco Central Europeu)",
            "live_data": True,
        }
    except Exception:
        return None


_CRYPTO_COINS = {
    "bitcoin": "bitcoin", "btc": "bitcoin",
    "ethereum": "ethereum", "eth": "ethereum",
    "dogecoin": "dogecoin", "doge": "dogecoin",
    "solana": "solana", "sol": "solana",
    "cardano": "cardano", "ada": "cardano",
    "ripple": "ripple", "xrp": "ripple",
    "criptomoeda": "bitcoin", "cripto": "bitcoin",
}


def _search_crypto(query: str) -> dict | None:
    """CoinGecko — free, keyless for basic simple-price lookups."""
    q = query.lower()
    coin_id = next((cid for word, cid in _CRYPTO_COINS.items() if word in q), None)
    if coin_id is None:
        return None
    try:
        resp = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={"ids": coin_id, "vs_currencies": "brl,usd", "include_24hr_change": "true"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get(coin_id)
        if not data:
            return None
        change = data.get("brl_24h_change", 0) or 0
        return {
            "title": coin_id.capitalize(),
            "url": "https://www.coingecko.com/",
            "content": f"{coin_id.capitalize()}: R$ {data.get('brl', 0):,.2f} / US$ {data.get('usd', 0):,.2f} "
                       f"(variacao 24h: {change:+.2f}%)",
            "live_data": True,
        }
    except Exception:
        return None


def _search_holiday(query: str) -> dict | None:
    """Nager.Date — free, keyless, public holidays (Brazil)."""
    if "feriado" not in query.lower():
        return None
    try:
        resp = requests.get("https://date.nager.at/api/v3/NextPublicHolidays/BR", timeout=10)
        resp.raise_for_status()
        holidays = resp.json()
        if not holidays:
            return None
        upcoming = "; ".join(f"{h['date']}: {h['localName']}" for h in holidays[:3])
        return {"title": "Proximos feriados no Brasil", "url": "https://date.nager.at/",
                "content": upcoming, "live_data": True}
    except Exception:
        return None


def _search_tavily(query: str, api_key: str) -> dict | None:
    """Tavily — free tier (1000 searches/month), built for LLM/agent search use
    cases, returns clean summarized results instead of raw HTML to scrape."""
    if not api_key:
        return None
    try:
        resp = requests.post(
            "https://api.tavily.com/search",
            json={"api_key": api_key, "query": query, "max_results": 3, "include_answer": True},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        answer = data.get("answer", "")
        results = data.get("results", [])
        if not answer and not results:
            return None
        content = answer or ""
        if results:
            content += "\n\n" + "\n".join(f"- {r.get('title', '')}: {r.get('content', '')[:300]}" for r in results[:3])
        return {
            "title": results[0].get("title", query) if results else query,
            "url": results[0].get("url", "") if results else "",
            "content": content.strip(),
        }
    except Exception:
        return None


def _search_duckduckgo_html(query: str) -> dict | None:
    """DuckDuckGo's plain server-rendered HTML endpoint — no key, no JS, no
    browser. Kept as a fallback, but DDG has been returning bot-challenge pages
    (HTTP 202, no real results) for both this and the full browser scrape."""
    try:
        resp = requests.get(
            "https://html.duckduckgo.com/html/", params={"q": query},
            headers=_HEADERS, timeout=10,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        result = soup.select_one(".result__a")
        if not result:
            return None
        snippet_el = soup.select_one(".result__snippet")
        return {
            "title": result.get_text(strip=True),
            "url": result.get("href", ""),
            "content": snippet_el.get_text(strip=True) if snippet_el else "",
        }
    except Exception:
        return None


def _search_wikipedia(query: str, lang: str = "pt") -> dict | None:
    """Wikipedia search + summary — no key, reliable for factual/definitional
    queries (won't have live data like current weather/prices)."""
    try:
        search_resp = requests.get(
            f"https://{lang}.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": 1},
            headers=_HEADERS, timeout=10,
        )
        search_resp.raise_for_status()
        hits = search_resp.json().get("query", {}).get("search", [])
        if not hits:
            return None
        title = hits[0]["title"]
        summary_resp = requests.get(
            f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}",
            headers=_HEADERS, timeout=10,
        )
        summary_resp.raise_for_status()
        data = summary_resp.json()
        return {
            "title": data.get("title", title),
            "url": data.get("content_urls", {}).get("desktop", {}).get("page", ""),
            "content": data.get("extract", ""),
        }
    except Exception:
        return None


def search_and_read(query: str, tavily_api_key: str = "") -> dict:
    """Tries multiple free sources in order — dedicated live-data sources first
    (weather/currency/crypto/holidays — the only ones with real live numbers,
    keyword-gated so they only fire for matching queries), then Tavily (if a
    key is configured — reliable, built for agent search), then Wikipedia
    (facts, no live data), then DuckDuckGo's HTML endpoint (currently bot-
    blocked more often than not) — before falling back to a headless-browser
    DuckDuckGo scrape as the last resort (JS-rendered, selectors drift, least
    reliable)."""
    for dedicated in (_search_weather, _search_currency, _search_crypto, _search_holiday):
        result = dedicated(query)
        if result:
            return result

    for source in (lambda q: _search_tavily(q, tavily_api_key), _search_wikipedia, _search_duckduckgo_html):
        result = source(query)
        if result and result.get("content"):
            return result

    ctx = _get_browser()
    page = ctx.new_page()
    try:
        search_url = f"https://duckduckgo.com/?q={query}"
        page.goto(search_url, timeout=15000)
        page.wait_for_timeout(2000)

        first_link = page.locator('[data-testid="result-title-a"]').first
        if first_link.count() > 0:
            first_link.click()
            page.wait_for_timeout(3000)
            title = page.title()
            url = page.url
            text = page.evaluate(_EXTRACT_JS)
            return {"title": title, "url": url, "content": text[:3000]}
        return {"error": "nenhuma fonte de busca (DuckDuckGo HTML, Wikipedia, navegador) retornou resultado", "url": query}
    except Exception as e:
        return {"error": str(e), "url": query}
    finally:
        page.close()


def visit(url: str, max_chars: int = 5000) -> dict:
    """Visit a URL and extract main text content."""
    ctx = _get_browser()
    page = ctx.new_page()
    try:
        page.goto(url, timeout=15000, wait_until="domcontentloaded")
        text = page.evaluate(_EXTRACT_JS)
        title = page.title()
        return {"title": title, "url": url, "content": text[:max_chars]}
    except Exception as e:
        return {"error": str(e), "url": url}
    finally:
        page.close()


def fetch_news() -> str:
    """Fetch current world news from worldmonitor.app, headless."""
    ctx = _get_browser()
    page = ctx.new_page()
    try:
        page.goto("https://www.worldmonitor.app/", timeout=20000)
        page.wait_for_timeout(6000)  # wait for JS to render
        text = page.evaluate("() => document.body.innerText")
        return f"Noticias do World Monitor:\n{text[:4000]}"
    except Exception as e:
        return f"Nao foi possivel carregar as noticias: {e}"


def open_url(url: str):
    """Open URL in user's default browser (non-blocking)."""
    webbrowser.open(url)
    return {"success": True, "url": url}


def close():
    global _browser, _context, _playwright
    if _browser:
        _browser.close()
        _browser = None
        _context = None
    if _playwright:
        _playwright.stop()
        _playwright = None
