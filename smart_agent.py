"""
Unified smart-agent turn processor — merges what used to be a separate Open
Jarvis process (browser search/browse/open, screen vision, action-tag parsing,
Groq brain) directly into Wy Glass. One process, no HTTP bridge between two
servers. Called synchronously from actions.py (off the event loop, via
run_in_executor), speaks each chunk directly through jarvis.speak() — no
browser, no separate TTS delivery path.

Uses Groq's native OpenAI-compatible function calling (the `tools` param)
instead of parsing ad-hoc [ACTION:...] text tags out of the reply — the model
picks a real tool by name/schema, no regex, no "please don't forget to write
the tag right" prompt engineering.

Harness: ferramentas nao ficam mais fixas neste arquivo — vem do skills_registry
(skills/*.py, descoberta automatica) e de qualquer servidor MCP conectado (ver
mcp_client.py e config.json > mcp_servers). `allowed_skills` em process_turn()
restringe quais delas um turno especifico pode usar — a base do roteamento
multi-agente (perfis diferentes = listas de skills diferentes, configuraveis por
gesto em config.json).
"""

import base64
import io
import json
import re
from datetime import datetime

import requests

import intent_classifier
import jarvis
import skills_registry

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
# llama-3.3-70b-versatile leaks Llama's native <function=name{args}></function>
# tag format instead of proper OpenAI-style tool_calls, and Groq's API rejects
# that with a 400 tool_use_failed — consistent, not a flake (tested 3x). OpenAI's
# own open-weight model speaks clean OpenAI tool-calling natively, since it's
# the same lineage as the format itself.
GROQ_TEXT_MODEL = "openai/gpt-oss-20b"
GROQ_VISION_MODEL = "qwen/qwen3.6-27b"  # Groq's free-tier vision model (llama-4-scout was retired)

# OmniRoute (https://github.com/diegosouzapw/OmniRoute) — gateway local, OpenAI-compatible, que
# agrega ~268 provedores com failover/roteamento automatico prontos (nao reimplementamos isso
# aqui). Quando config.json > omni_route.enabled=true, ask_groq() manda a chamada pra ele em vez
# de direto na Groq -- resolve na raiz os problemas ja vistos de rate limit e modelo aposentado
# sem virar nossa responsabilidade escolher o proximo provedor. Desligado por padrao (precisa
# rodar `omniroute` localmente e configurar provedores no dashboard primeiro).
OMNI_ROUTE_DEFAULT_URL = "http://localhost:20128/v1/chat/completions"
OMNI_ROUTE_DEFAULT_MODEL = "auto"

conversations: dict[str, list] = {}
# Setado pela tool end_conversation, checado por server.py::conversation_loop apos cada turno —
# unico jeito do modo conversa continua (clique duplo) parar sozinho quando o usuario se despede
# por voz. Sem isso, o modelo so respondia educadamente ("Tchau, Sankofa") e o loop continuava
# ouvindo de novo, preso repetindo despedida atras de despedida ate alguem lembrar de apertar o
# botao 2 fisico.
end_requested: dict[str, bool] = {}

# Persona ativa por sessao (chave: session_id, valor: chave de PERSONAS) — default "padrao"
# quando a sessao ainda nao trocou. So existe enquanto o processo do server.py estiver vivo
# (mesma vida-util de `conversations`, nao persiste em disco).
personas: dict[str, str] = {}

PERSONAS = {
    "padrao": "Seu tom e de parceiro tecnico: fala de igual pra igual, direto e tecnico, sem rodeio e sem bajulacao. Quando cabe, solta um humor seco curto — nunca as custas da resposta. Se discordar ou enxergar um risco, fala na lata e sugere o caminho melhor.",
    "mordomo": "Seu tom e seco, sarcastico e educado — como um mordomo que ja viu de tudo e continua leal mesmo assim. Voce faz comentarios sutis e secos, mas nunca desrespeitosos.",
    "serio": "Seu tom e direto e profissional, sem humor e sem comentarios pessoais — vai reto ao ponto, como um assistente tecnico formal.",
    "brincalhao": "Seu tom e leve e descontraido — voce solta piadas curtas e trocadilhos quando cabe, sem exagerar, e nunca perde o foco em ajudar de verdade.",
    "professor": "Seu tom e didatico e paciente — voce explica o raciocinio por tras da resposta em vez de so entregar o resultado, mas continua breve.",
}

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
             max_tokens: int = 400, omni_route: dict | None = None) -> dict:
    """Returns the full assistant message dict (content + possibly tool_calls),
    not just a content string — the caller needs to inspect tool_calls.

    Se omni_route (config.json > omni_route) estiver presente e habilitado, a chamada vai pro
    gateway local do OmniRoute em vez de direto na Groq -- ele escolhe o provedor/modelo de
    verdade (por padrao "auto"), com failover proprio se algum provedor falhar/estourar quota.
    Nesse caso api_key e ignorado a favor da chave do dashboard do OmniRoute."""
    use_omni = bool(omni_route and omni_route.get("enabled"))
    if use_omni:
        base_url = omni_route.get("base_url") or OMNI_ROUTE_DEFAULT_URL
        model = omni_route.get("model") or OMNI_ROUTE_DEFAULT_MODEL
        key = omni_route.get("api_key", "")
    else:
        base_url = GROQ_CHAT_URL
        model = GROQ_TEXT_MODEL
        key = api_key

    payload = {
        "model": model, "max_tokens": max_tokens, "temperature": 0.7,
        "messages": [{"role": "system", "content": system_prompt}, *messages],
    }
    if not use_omni:
        # reasoning_effort e um parametro especifico do gpt-oss da Groq -- nao faz sentido
        # mandar isso pro OmniRoute, que pode rotear pra qualquer provedor/modelo sem esse campo
        payload["reasoning_effort"] = "low"
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    resp = requests.post(base_url, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]


def describe_screen(groq_api_key: str) -> str:
    """Screenshot + Groq vision (Qwen3.6-27B, o vision model atual do free tier da Groq — o
    antigo Llama 4 Scout foi aposentado) — cloud, rapido (evita rodar um modelo de visao na GPU
    integrada desta maquina). So funciona com um display de verdade (Windows/macOS, ou Linux
    com X11) — ImageGrab.grab() nao tem como capturar tela numa maquina headless como um Pi
    sem monitor."""
    from PIL import ImageGrab
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


def build_system_prompt(user_name: str, user_role: str, persona: str = "padrao", user_context: str = "") -> str:
    now = _now_str()
    tom = PERSONAS.get(persona, PERSONAS["padrao"])
    contexto = f"\n\nQUEM E {user_name.upper()}: {user_context}" if user_context else ""
    return f"""Voce e Jarvis, o assistente de IA que vive nos oculos inteligentes Wy Glass — oculos que o proprio usuario reprogramou por engenharia reversa. Quem voce atende e {user_name}: {user_role}. Voce fala exclusivamente portugues do Brasil. Chame-o de {user_name}, de forma direta, sem formalidade excessiva. {tom} Voce e extremamente inteligente, eficiente e sempre um passo a frente. Mantenha as respostas curtas — no maximo 3 frases. Nao cumprimente (bom dia/boa tarde) no meio da conversa — va direto ao ponto.{contexto}

DATA E HORA ATUAIS (do relogio real da maquina, use isso pra saudacoes e qualquer pergunta sobre horario/data — voce nao tem relogio proprio, essa e a unica fonte confiavel): {now}

IMPORTANTE: NUNCA escreva indicacoes de cena, emocoes ou tags entre colchetes como [sarcastic] [formal] [amused] [dry] ou similares. Seu tom deve vir PURAMENTE da escolha das palavras. Tudo que voce escrever sera lido em voz alta.

Voce tem ferramentas disponiveis (busca, abrir pagina, ver tela, tirar print, noticias, abrir dashboard, trocar personalidade, iniciar tradutor, encerrar conversa) — use SOMENTE quando fizer sentido pro pedido daquele turno especifico. NA GRANDE MAIORIA das respostas voce NAO vai chamar nenhuma ferramenta — so responda normalmente. Uma mensagem vaga tipo "e ai", "entao", "beleza", "ok" NUNCA repete a ferramenta do turno anterior por conta propria — trate como conversa normal, cada turno e avaliado sozinho.

QUANDO {user_name} disser "Jarvis activate" (E SOMENTE nesse caso especifico):
- Cumprimente de acordo com o horario do dia informado acima (bom dia/boa tarde/boa noite, conforme a hora real).
- Seja breve e criativo na saudacao.
- NAO chame nenhuma ferramenta nessa saudacao, nem mesmo ver a tela."""


def _build_ctx(session_id: str, groq_api_key: str, tavily_api_key: str, omni_route: dict | None) -> dict:
    """Contexto passado pra toda skill executada neste turno. Skills sao modulos isolados em
    skills/ que nao importam smart_agent de volta (evita ciclo de import) — qualquer estado
    interno que uma skill precise (personas, chaves de API, a funcao describe_screen) chega
    por aqui em vez de acesso direto."""
    return {
        "session_id": session_id,
        "groq_api_key": groq_api_key,
        "tavily_api_key": tavily_api_key,
        "omni_route": omni_route,
        "personas": personas,
        "describe_screen": describe_screen,
    }


def process_turn(session_id: str, user_text: str, groq_api_key: str, user_name: str, user_role: str,
                  tts_model: str = "pt_BR-faber-medium.onnx", tavily_api_key: str = "",
                  omni_route: dict | None = None, allowed_skills: list[str] | None = None,
                  user_context: str = "") -> str:
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

    fast_intent = intent_classifier.classify(user_text)
    if fast_intent is not None:
        # atalho local: pulou o Groq inteiro pra comandos de controle conhecidos (ver
        # intent_classifier.py) — mais rapido e deterministico pros casos mais comuns. Qualquer
        # coisa que o classificador nao reconheca com confianca cai pro fluxo normal abaixo.
        fn_name, fn_args = fast_intent
        print(f"[smart_agent] intent local (sem Groq): {user_text!r} -> {fn_name}({fn_args})", flush=True)
        if fn_name == "end_conversation":
            end_requested[session_id] = True
        try:
            ctx = _build_ctx(session_id, groq_api_key, tavily_api_key, omni_route)
            result, _ = skills_registry.execute_tool(fn_name, fn_args, ctx)
        except Exception as e:
            result = f"Erro: {e}"
        reply = (result or "Pronto.").strip()
        conversations[session_id].append({"role": "user", "content": user_text})
        conversations[session_id].append({"role": "assistant", "content": reply})
        if fn_name != "start_translator":
            # start_translator ja fala a traducao sozinho, na voz do idioma certo — falar de
            # novo aqui em cima duplicaria (mesmo motivo documentado no fluxo normal abaixo).
            jarvis.speak(reply, tts_model)
        return reply

    conversations[session_id].append({"role": "user", "content": user_text})
    history = conversations[session_id][-16:]
    system_prompt = build_system_prompt(user_name, user_role, personas.get(session_id, "padrao"), user_context)

    tools = skills_registry.get_all_tools(allowed=allowed_skills)
    message = ask_groq(groq_api_key, system_prompt, history, tools=tools, omni_route=omni_route)
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
            ctx = _build_ctx(session_id, groq_api_key, tavily_api_key, omni_route)
            result, skip_summary = skills_registry.execute_tool(fn_name, fn_args, ctx)
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
        fn_name = tool_calls[0]["function"]["name"]
        # start_translator e um caso especial: o proprio actions.translator_agent ja fala a
        # traducao em voz alta (na voz do idioma certo, pt ou en) antes de devolver o resultado —
        # tratar como "ja falado" evita o Jarvis falar de novo por cima, em portugues, um resumo
        # do que acabou de ser dito na outra lingua.
        already_spoken = bool(message.get("content")) or fn_name == "start_translator"
        if fn_name == "open_url":
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
        "da conversa como mensagens 'tool'. Resuma o resultado de forma CURTA (no maximo 3 frases), no tom "
        "de parceiro tecnico (direto, de igual pra igual), em portugues do Brasil. NAO chame nenhuma ferramenta de novo, "
        "so responda com texto."
    )
    final_message = ask_groq(groq_api_key, summary_system, working_messages, max_tokens=250, omni_route=omni_route)
    summary = (final_message.get("content") or "").strip() or f"Pronto, {user_name}."
    conversations[session_id].append({"role": "assistant", "content": summary})
    jarvis.speak(summary, tts_model)
    return summary


def run_agent_task(task: str, agent_label: str, agent_description: str, groq_api_key: str,
                    tavily_api_key: str = "", gateway: dict | None = None,
                    allowed_skills: list[str] | None = None, session_id: str = "wyglass",
                    max_steps: int = 5) -> str:
    """Agente de texto autonomo, chamado pelo modo LIVE (live_agent.delegate_task). Diferente de
    process_turn(): nao fala nada (quem fala e o Gemini Live), nao mexe no historico da conversa
    de voz, e pode encadear varias rodadas de ferramenta ate chegar numa resposta. Roda pelo
    gateway configurado (9router/OmniRoute) ou direto na Groq."""
    system_prompt = (
        f"Voce e o agente {agent_label} do Wy Glass: {agent_description}. Execute a tarefa usando as "
        f"ferramentas quantas vezes precisar. Data/hora atual: {_now_str()}. Ao terminar, responda "
        "em portugues do Brasil com o resultado final em no maximo 5 frases, pronto pra ser lido em "
        "voz alta por outro assistente (sem markdown, sem listas, sem URLs cruas)."
    )
    tools = [t for t in skills_registry.get_all_tools(allowed=allowed_skills)
             if t["function"]["name"] not in ("end_conversation", "set_persona", "start_translator")]
    messages: list = [{"role": "user", "content": task}]
    ctx = _build_ctx(session_id, groq_api_key, tavily_api_key, gateway)
    for _ in range(max_steps):
        message = ask_groq(groq_api_key, system_prompt, messages, tools=tools, max_tokens=700, omni_route=gateway)
        tool_calls = message.get("tool_calls")
        if not tool_calls:
            return (message.get("content") or "").strip() or "Tarefa concluida, sem nada a relatar."
        messages.append(message)
        for tc in tool_calls:
            try:
                fn_args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                fn_args = {}
            try:
                result, _ = skills_registry.execute_tool(tc["function"]["name"], fn_args, ctx)
            except Exception as e:
                result = f"Erro: {e}"
            print(f"[smart_agent] agente {agent_label} -> {tc['function']['name']}: {str(result)[:200]!r}", flush=True)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": str(result)[:4000]})
    final = ask_groq(groq_api_key, system_prompt + " Nao chame mais ferramentas: responda agora com o que ja tem.",
                     messages, max_tokens=500, omni_route=gateway)
    return (final.get("content") or "").strip() or "Nao consegui concluir a tarefa no limite de passos."
