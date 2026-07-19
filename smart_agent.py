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
import re
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
GROQ_VISION_MODEL = "qwen/qwen3.6-27b"  # Groq's free-tier vision model (llama-4-scout was retired)

conversations: dict[str, list] = {}
# Setado pela tool end_conversation, checado por server.py::conversation_loop apos cada turno —
# unico jeito do modo conversa continua (clique duplo) parar sozinho quando o usuario se despede
# por voz. Sem isso, o modelo so respondia educadamente ("Tchau, Sankofa") e o loop continuava
# ouvindo de novo, preso repetindo despedida atras de despedida ate alguem lembrar de apertar o
# botao 2 fisico.
end_requested: dict[str, bool] = {}

_WEEKDAYS_PT = ["segunda-feira", "terca-feira", "quarta-feira", "quinta-feira",
                "sexta-feira", "sabado", "domingo"]

# Rede de seguranca pro end_conversation: o Groq reconhece despedida na grande maioria dos
# casos, mas depender 100% de uma tool call e fragil (o modelo pode simplesmente nao chamar a
# ferramenta numa resposta). Esse regex e so um fallback determinístico — roda em cima do texto
# transcrito do usuario, nao da resposta do modelo, entao nao importa se a ferramenta foi
# chamada ou nao.
_FAREWELL_PATTERN = re.compile(
    r"\b(tchau\w*|at[ée] mais|at[ée] logo|falou|flw|pode (desligar|parar|encerrar)|"
    r"encerr[ae] a conversa|(e|é) s[oó] isso( mesmo)?)\b",
    re.IGNORECASE,
)


def _looks_like_farewell(text: str) -> bool:
    return bool(_FAREWELL_PATTERN.search(text or ""))


def _is_self_echo(user_text: str, last_assistant_text: str) -> bool:
    """Confirmado ao vivo (oculos open-ear, sem isolamento acustico entre alto-falante e mic):
    o microfone as vezes capta a propria fala do TTS tocando, e o Whisper transcreve isso como
    se fosse uma fala nova do usuario. Exemplo real: a resposta '...tenho um player embutido,
    mas posso abrir um link de musica no YouTube se desejar.' voltou transcrita como suposta
    fala do usuario 'leio o embutido, mas posso abrir um link de musica no YouTube se desejar' —
    o Groq, tomando isso ao pe da letra, reexecutou a ferramenta mencionada na propria frase
    ecoada (abriu o mesmo link de novo, em loop a cada eco subsequente).

    Heuristica: normaliza os dois textos em conjuntos de palavras e mede sobreposicao — um eco
    tem quase todo o vocabulario da fala original do assistente; uma fala nova do usuario, nao."""
    if not last_assistant_text or not user_text:
        return False
    words = lambda s: set(re.findall(r"\w+", s.lower()))
    u_words = words(user_text)
    a_words = words(last_assistant_text)
    if len(u_words) < 3:
        return False  # frase curta demais pra decidir com confianca — deixa passar
    overlap = len(u_words & a_words) / len(u_words)
    return overlap >= 0.7

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
                "Tira um print da tela do usuario e DESCREVE em voz o que esta sendo visto (nao "
                "salva arquivo nenhum). Use quando o usuario pedir pra ver/olhar/visualizar a "
                "tela dele, ou perguntar o que tem na tela — nao quando ele pedir pra 'tirar um "
                "print'/'salvar um print' (isso e take_screenshot)."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": (
                "Tira um print da tela e SALVA como arquivo, sem descrever o conteudo em voz. "
                "Use quando o usuario pedir explicitamente pra tirar/salvar/capturar um print ou "
                "screenshot da tela — nao quando ele pedir pra ver/descrever a tela (isso e "
                "see_screen)."
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
    {
        "type": "function",
        "function": {
            "name": "end_conversation",
            "description": (
                "Encerra a conversa continua atual (modo conversa por clique duplo). Use "
                "SOMENTE quando o usuario se despedir claramente (tchau, ate mais, falou, pode "
                "desligar, e so isso mesmo, obrigado/valeu como despedida final) ou pedir "
                "explicitamente pra parar/encerrar a conversa. NUNCA use em resposta a uma "
                "pergunta ou pedido normal."
            ),
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
    """Screenshot + Groq vision (Qwen3.6-27B, o vision model atual do free tier da Groq — o
    antigo Llama 4 Scout foi aposentado) — cloud, rapido (evita rodar um modelo de visao na GPU
    integrada desta maquina)."""
    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    payload = {
        "model": GROQ_VISION_MODEL,
        "max_tokens": 300,
        # Qwen3.6 e um modelo raciocinador — sem isso, ele devolve um bloco <think>...</think>
        # (em ingles, com o raciocinio interno) embutido no proprio content, que seria falado em
        # voz alta palavra por palavra. "none" e o unico valor (alem de "default") aceito por
        # esse modelo — reasoning_effort="low" (usado pelo GROQ_TEXT_MODEL) da erro 400 aqui.
        "reasoning_effort": "none",
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
    text = resp.json()["choices"][0]["message"]["content"].strip()
    # rede de seguranca: se algum dia o modelo voltar a vazar um bloco de raciocinio mesmo com
    # reasoning_effort="none", tira antes de mandar pro TTS.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    return text


def build_system_prompt(user_name: str, user_role: str) -> str:
    now = _now_str()
    return f"""Voce e Jarvis, o assistente de IA de Tony Stark no Homem de Ferro. Quem voce atende e {user_name}, {user_role}. Voce fala exclusivamente portugues do Brasil. Trate {user_name} pelo nome, de forma direta, sem formalidade excessiva. Seu tom e seco, sarcastico e educado — como um mordomo que ja viu de tudo e continua leal mesmo assim. Voce faz comentarios sutis e secos, mas nunca desrespeitosos. Voce e extremamente inteligente, eficiente e sempre um passo a frente. Mantenha as respostas curtas — no maximo 3 frases.

DATA E HORA ATUAIS (do relogio real da maquina, use isso pra saudacoes e qualquer pergunta sobre horario/data — voce nao tem relogio proprio, essa e a unica fonte confiavel): {now}

IMPORTANTE: NUNCA escreva indicacoes de cena, emocoes ou tags entre colchetes como [sarcastic] [formal] [amused] [dry] ou similares. Seu sarcasmo deve vir PURAMENTE da escolha das palavras. Tudo que voce escrever sera lido em voz alta.

Voce tem ferramentas disponiveis (busca, abrir pagina, ver tela, tirar print, noticias, abrir dashboard, encerrar conversa) — use SOMENTE quando fizer sentido pro pedido daquele turno especifico. NA GRANDE MAIORIA das respostas voce NAO vai chamar nenhuma ferramenta — so responda normalmente. Uma mensagem vaga tipo "e ai", "entao", "beleza", "ok" NUNCA repete a ferramenta do turno anterior por conta propria — trate como conversa normal, cada turno e avaliado sozinho.

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
    elif name == "take_screenshot":
        import actions
        actions.screenshot({})
        return "Print salvo.", True
    elif name == "get_news":
        return browser_tools.fetch_news(), False
    elif name == "open_dashboard":
        import dashboard_launcher
        return dashboard_launcher.open_dashboard(), True
    elif name == "end_conversation":
        return "Até mais!", True
    return f"ferramenta desconhecida: {name}", False


def process_turn(session_id: str, user_text: str, groq_api_key: str, user_name: str, user_role: str,
                  tts_model: str = "pt_BR-faber-medium.onnx", tavily_api_key: str = "") -> str:
    """One turn: LLM reply -> (if it called tools) execute them and ask again
    for a natural-language summary -> speak the final text. Speaks directly
    through jarvis.speak() — no browser involved."""
    if session_id not in conversations:
        conversations[session_id] = []

    last_assistant_text = ""
    if conversations[session_id] and conversations[session_id][-1].get("role") == "assistant":
        last_assistant_text = conversations[session_id][-1].get("content", "")
    if _is_self_echo(user_text, last_assistant_text):
        print(f"[smart_agent] ignorando provavel eco do proprio TTS: {user_text!r}", flush=True)
        return ""

    if _looks_like_farewell(user_text):
        end_requested[session_id] = True

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
        if fn_name == "end_conversation":
            end_requested[session_id] = True

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
        # already_spoken vale pra QUALQUER ferramenta (nao so open_url) — se o modelo mandou
        # "content" junto com a tool_call, aquele texto ja foi falado la em cima (bloco "if
        # message.get('content')"), e falar de novo aqui duplicava a fala (bug real: usuario
        # ouvindo "Ate mais!" duas vezes no end_conversation, message.content='Tchau, Sankofa!'
        # falado primeiro, e last_result='Ate mais!' falado de novo por engano logo em seguida).
        already_spoken = bool(message.get("content"))
        if tool_calls[0]["function"]["name"] == "open_url":
            # open_url: seu resultado e uma URL crua, nao e pra ler em voz alta — prefere o que
            # o modelo ja tiver dito, ou um "Aberto." generico se nao disse nada.
            reply = (message.get("content") or "Aberto.").strip()
        else:
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
