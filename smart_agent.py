"""
Unified smart-agent turn processor — merges what used to be a separate Open
Jarvis process (browser search/browse/open, screen vision, action-tag parsing,
Groq brain) directly into Wy Glass. One process, no HTTP bridge between two
servers. Called synchronously from actions.py (off the event loop, via
run_in_executor), speaks each chunk directly through jarvis.speak() — no
browser, no separate TTS delivery path.

Fase 1 of the agents/MCP/skills roadmap: uses Groq's native OpenAI-compatible
function calling (the `tools` param) instead of parsing ad-hoc [ACTION:...]
text tags out of the reply — the model picks a real tool by name/schema, no
regex, no "please don't forget to write the tag right" prompt engineering.
This is the foundation the next phases (pluggable skills registry, MCP client,
multi-agent routing) build on top of.
"""

import base64
import io
import json
from datetime import datetime

import requests
from PIL import ImageGrab

import browser_tools
import jarvis

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
# llama-3.3-70b-versatile leaks Llama's native <function=name{args}></function>
# tag format instead of proper OpenAI-style tool_calls, and Groq's API rejects
# that with a 400 tool_use_failed — consistent, not a flake (tested 3x). OpenAI's
# own open-weight model speaks clean OpenAI tool-calling natively, since it's
# the same lineage as the format itself.
GROQ_TEXT_MODEL = "openai/gpt-oss-20b"
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"  # Groq's free-tier vision model

conversations: dict[str, list] = {}

_WEEKDAYS_PT = ["segunda-feira", "terca-feira", "quarta-feira", "quinta-feira",
                "sexta-feira", "sabado", "domingo"]

# --------------------------------------------------------------- tools -----
# Fase 2 (roteiro) troca isto por um registro plugavel (skills descobertas por
# modulo, cada uma trazendo seu proprio schema); por ora e uma lista fixa.

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": (
                "Pesquisa na internet. Cobre busca geral E dados ao vivo especificos: "
                "clima/tempo/temperatura, cambio/cotacao de moeda (dolar, euro, etc), "
                "preco de criptomoeda (bitcoin, etc), proximos feriados. Use sempre que "
                "o usuario pedir pra pesquisar/buscar algo, ou perguntar um desses dados "
                "ao vivo (nao precisa da palavra 'pesquisa' pra isso — 'quanto ta o dolar' "
                "ja e um pedido de search)."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "o que pesquisar"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_url",
            "description": "Abre uma URL/site especifico no navegador padrao do usuario.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "URL completa a abrir"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "see_screen",
            "description": (
                "Tira um print da tela do usuario e descreve o que esta sendo visto. "
                "Use SOMENTE se o usuario pedir explicitamente pra ver/olhar/visualizar a tela dele."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_news",
            "description": "Busca noticias atuais do mundo. Use se o usuario pedir noticias/o que esta acontecendo.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_dashboard",
            "description": "Abre o painel de controle/configuracoes dos oculos (Dashboard).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _now_str() -> str:
    """Real wall-clock time from this machine — the LLM has no clock of its
    own, so this must be injected into the prompt on every turn, not guessed."""
    now = datetime.now()
    return f"{_WEEKDAYS_PT[now.weekday()]}, {now.strftime('%d/%m/%Y')}, {now.strftime('%H:%M')}"


def greeting_text(user_name: str) -> str:
    """Deterministic activation greeting — no Groq call needed (this used to
    round-trip through process_turn()/the LLM just to say 'bom dia'), same
    spirit as stop_conversation's static farewell_text: fast, no network."""
    hour = datetime.now().hour
    if hour < 12:
        saudacao = "Bom dia"
    elif hour < 18:
        saudacao = "Boa tarde"
    else:
        saudacao = "Boa noite"
    return f"{saudacao}, {user_name}. O que voce precisa?"


def ask_groq(api_key: str, system_prompt: str, messages: list, tools: list | None = None,
             max_tokens: int = 400) -> dict:
    """Returns the full assistant message dict (content + possibly tool_calls),
    not just a content string — the caller needs to inspect tool_calls."""
    payload = {
        "model": GROQ_TEXT_MODEL, "max_tokens": max_tokens, "temperature": 0.7,
        # gpt-oss models emit a chain-of-thought "reasoning" field before the
        # real answer/tool_call — "low" cuts that generation short (tested:
        # same tool-picking reliability, noticeably less latency) vs the
        # unset/"medium" default.
        "reasoning_effort": "low",
        "messages": [{"role": "system", "content": system_prompt}, *messages],
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    resp = requests.post(
        GROQ_CHAT_URL, headers={"Authorization": f"Bearer {api_key}"}, json=payload, timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]


def describe_screen(groq_api_key: str) -> str:
    """Screenshot + Groq vision (Llama 4 Scout) — cloud, free tier, fast (avoids
    running a vision model on this machine's CPU-only integrated GPU)."""
    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    payload = {
        "model": GROQ_VISION_MODEL,
        "max_tokens": 300,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Descreva brevemente em portugues do Brasil o que esta sendo visto "
                                          "nesta tela. Maximo 2-3 frases. Cite os programas e conteudos mais "
                                          "importantes abertos."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ],
        }],
    }
    resp = requests.post(
        GROQ_CHAT_URL, headers={"Authorization": f"Bearer {groq_api_key}"}, json=payload, timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def build_system_prompt(user_name: str, user_role: str) -> str:
    now = _now_str()
    return f"""Voce e Jarvis, o assistente de IA de Tony Stark no Homem de Ferro. Quem voce atende e {user_name}, {user_role}. Voce fala exclusivamente portugues do Brasil. Trate {user_name} pelo nome, de forma direta, sem formalidade excessiva. Seu tom e seco, sarcastico e educado — como um mordomo que ja viu de tudo e continua leal mesmo assim. Voce faz comentarios sutis e secos, mas nunca desrespeitosos. Voce e extremamente inteligente, eficiente e sempre um passo a frente. Mantenha as respostas curtas — no maximo 3 frases.

DATA E HORA ATUAIS (do relogio real da maquina, use isso pra saudacoes e qualquer pergunta sobre horario/data — voce nao tem relogio proprio, essa e a unica fonte confiavel): {now}

IMPORTANTE: NUNCA escreva indicacoes de cena, emocoes ou tags entre colchetes como [sarcastic] [formal] [amused] [dry] ou similares. Seu sarcasmo deve vir PURAMENTE da escolha das palavras. Tudo que voce escrever sera lido em voz alta.

Voce tem ferramentas disponiveis (busca, abrir pagina, ver tela, noticias, abrir dashboard) — use SOMENTE quando fizer sentido pro pedido daquele turno especifico. NA GRANDE MAIORIA das respostas voce NAO vai chamar nenhuma ferramenta — so responda normalmente. Uma mensagem vaga tipo "e ai", "entao", "beleza", "ok" NUNCA repete a ferramenta do turno anterior por conta propria — trate como conversa normal, cada turno e avaliado sozinho.

QUANDO {user_name} disser "Jarvis activate" (E SOMENTE nesse caso especifico):
- Cumprimente de acordo com o horario do dia informado acima (bom dia/boa tarde/boa noite, conforme a hora real).
- Seja breve e criativo na saudacao.
- NAO chame nenhuma ferramenta nessa saudacao, nem mesmo ver a tela."""


def execute_tool(name: str, args: dict, groq_api_key: str, tavily_api_key: str = "") -> tuple[str, bool]:
    """Returns (result_text, skip_summary). skip_summary=True means result_text
    is already a short, ready-to-speak answer — no need for a second Groq
    round-trip just to rephrase it (saves a full API call + reasoning latency
    on the most common quick-fact queries: weather/currency/crypto/holidays,
    plus screen descriptions, which Groq vision already returns in natural
    language)."""
    if name == "search":
        result = browser_tools.search_and_read(args.get("query", ""), tavily_api_key=tavily_api_key)
        if "error" not in result:
            if result.get("live_data"):
                return result.get("content", ""), True
            return f"Pagina: {result.get('title', '')}\nURL: {result.get('url', '')}\n\n{result.get('content', '')[:2000]}", False
        return f"Busca falhou: {result.get('error', '')}", False
    elif name == "open_url":
        url = args.get("url", "")
        browser_tools.open_url(url)
        return f"Aberto: {url}", True
    elif name == "see_screen":
        return describe_screen(groq_api_key), True
    elif name == "get_news":
        return browser_tools.fetch_news(), False
    elif name == "open_dashboard":
        import dashboard_launcher
        return dashboard_launcher.open_dashboard(), True
    return f"ferramenta desconhecida: {name}", False


def process_turn(session_id: str, user_text: str, groq_api_key: str, user_name: str, user_role: str,
                  tts_model: str = "pt_BR-faber-medium.onnx", tavily_api_key: str = "") -> str:
    """One turn: LLM reply -> (if it called tools) execute them and ask again
    for a natural-language summary -> speak the final text. Speaks directly
    through jarvis.speak() — no browser involved."""
    if session_id not in conversations:
        conversations[session_id] = []

    conversations[session_id].append({"role": "user", "content": user_text})
    history = conversations[session_id][-16:]
    system_prompt = build_system_prompt(user_name, user_role)

    message = ask_groq(groq_api_key, system_prompt, history, tools=TOOLS)
    print(f"[smart_agent] user: {user_text!r}", flush=True)
    print(f"[smart_agent] assistant message: {message!r}", flush=True)

    tool_calls = message.get("tool_calls")
    if not tool_calls:
        reply = (message.get("content") or "").strip()
        if reply:
            conversations[session_id].append({"role": "assistant", "content": reply})
            jarvis.speak(reply, tts_model)
        return reply

    if message.get("content"):
        jarvis.speak(message["content"], tts_model)

    working_messages = history + [message]
    all_skip_summary = True
    last_result = ""
    for tc in tool_calls:
        fn_name = tc["function"]["name"]
        try:
            fn_args = json.loads(tc["function"].get("arguments") or "{}")
        except json.JSONDecodeError:
            fn_args = {}
        if fn_name == "see_screen":
            jarvis.speak("Deixa eu dar uma olhada na sua tela.", tts_model)

        try:
            result, skip_summary = execute_tool(fn_name, fn_args, groq_api_key, tavily_api_key)
        except Exception as e:
            result, skip_summary = f"Erro: {e}", False
        print(f"[smart_agent] tool result ({fn_name}): {result[:300]!r}", flush=True)
        working_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
        all_skip_summary = all_skip_summary and skip_summary
        last_result = result

    if len(tool_calls) == 1 and all_skip_summary:
        # already a short, ready-to-speak answer — skip the extra Groq round-trip.
        # open_url is the one exception: its result text is a raw URL, not
        # meant to be read aloud — prefer whatever the model already said
        # (which was already spoken above, if present — don't repeat it).
        if tool_calls[0]["function"]["name"] == "open_url":
            already_spoken = bool(message.get("content"))
            reply = (message.get("content") or "Aberto.").strip()
        else:
            already_spoken = False
            reply = (last_result or message.get("content") or "Pronto.").strip()
        conversations[session_id].append({"role": "assistant", "content": reply})
        if not already_spoken:
            jarvis.speak(reply, tts_model)
        return reply

    summary_system = (
        "Voce e Jarvis. Voce acabou de executar uma ou mais ferramentas — os resultados estao no historico "
        "da conversa como mensagens 'tool'. Resuma o resultado de forma CURTA (no maximo 3 frases), no seu "
        "estilo (seco, sarcastico, educado), em portugues do Brasil. NAO chame nenhuma ferramenta de novo, "
        "so responda com texto."
    )
    final_message = ask_groq(groq_api_key, summary_system, working_messages, max_tokens=250)
    summary = (final_message.get("content") or "").strip() or f"Pronto, {user_name}."
    conversations[session_id].append({"role": "assistant", "content": summary})
    jarvis.speak(summary, tts_model)
    return summary
