"""
live_agent.py — modo LIVE: conversa de voz realtime, full-duplex, direto no oculos.

Diferente do fluxo classico (grava com VAD -> Whisper -> LLM -> Piper, um turno por vez), aqui
o audio do microfone dos oculos vai em stream continuo pra Gemini Live API (speech-to-speech
nativo) e a resposta volta em stream de audio, tocada no alto-falante dos oculos enquanto ainda
esta sendo gerada. Latencia de fala pra fala na casa de centenas de ms, e o usuario pode
interromper o modelo no meio da frase (barge-in).

Ferramentas: as mesmas skills/MCP do harness (skills_registry), convertidas pra function
declarations do Gemini, mais `delegate_task` — despacha uma tarefa de varios passos pra um
agente de texto especializado (smart_agent.run_agent_task), que roda pelo gateway LLM
configurado (9router / OmniRoute / Groq). A voz fica no Gemini Live; o trabalho pesado, nos
agentes.

Threading: mesmo motivo de mcp_client.py — este modulo roda seu PROPRIO event loop asyncio numa
thread dedicada. sounddevice (mic + saida) nunca e importado na thread do event loop do
server.py (quebra o bleak/WinRT, ver server.py::_speak_blocking). O server so chama start()/stop()
e recebe eventos pelo callback on_event, que e chamado a partir desta thread.
"""
import asyncio
import collections
import queue
import threading
import time
from pathlib import Path

import numpy as np

DEFAULT_MODEL = "gemini-3.1-flash-live-preview"
# Fallback quando o modelo configurado cai com erro interno logo apos conectar. Medido em
# 2026-10-05: o gemini-3.8-live passou a responder 1011 a QUALQUER system_instruction acima de
# poucas dezenas de caracteres (ate texto neutro de 300 chars), enquanto 3.1-flash-live e
# 2.5-flash-native-audio aceitavam o prompt completo -- falha do lado do Google, por modelo.
MODEL_FALLBACKS = ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"]
MODEL_SWITCH_AFTER = 2  # quedas internas seguidas, cedo, no mesmo modelo
DEFAULT_VOICE = "Charon"
IN_RATE = 16000
OUT_RATE = 24000
# Os oculos sao open-ear: o alto-falante fica a centimetros do microfone, sem isolamento. Sem
# gate, o proprio audio do modelo volta pelo mic e o VAD do servidor interpreta como o usuario
# interrompendo -- o modelo se corta sozinho a cada frase. Enquanto ha audio tocando (e um pouco
# depois, pela latencia do A2DP), so passa pro modelo o que for alto o bastante pra ser o usuario
# falando por cima de proposito.
ECHO_TAIL_SECONDS = 0.6
DEFAULT_BARGE_IN_RMS = 2500
# Um pico isolado do proprio alto-falante passava pelo gate e o Gemini cortava a fala achando que
# era o usuario interrompendo. So libera o mic com N blocos seguidos (30 ms cada) acima do limite.
BARGE_IN_CHUNKS = 3
LEVEL_EVENT_INTERVAL = 1 / 15
ECHO_MARGIN = 1.6  # interrupcao so com voz 60% acima do eco medido (percentil 80) enquanto o modelo fala
KEEPALIVE_S = 20.0  # silencio enviado na pausa pra sessao nao expirar por inatividade
MAX_RECONNECT_FAILS = 8  # ~3 min de tentativas com espera crescente, depois desiste e avisa
LOG_PATH = Path(__file__).parent / "live_agent.log"


def _log(msg: str):
    """Diagnostico de audio por sessao (cortes, interrupcoes, reconexoes) -- o servidor costuma
    rodar sem console, entao print() some."""
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    except OSError:
        pass

# Tools que nao fazem sentido no modo live: o tradutor abre o proprio mic/TTS (briga com o stream
# deste modulo) e o Gemini Live ja traduz nativamente se pedirem.
_EXCLUDED_TOOLS = {"start_translator"}

AGENTS = {
    "pesquisador": {
        "label": "Pesquisador",
        "description": "pesquisa na web, le paginas, cruza fontes, noticias e dados ao vivo",
        "skills": ["search", "get_news", "open_url"],
    },
    "operador": {
        "label": "Operador",
        "description": ("opera o PC em varios passos: abre apps e sites, clica e digita guiado pela "
                        "tela, organiza janelas, midia, olha e captura a tela"),
        "skills": ["open_url", "open_project", "take_screenshot", "see_screen", "open_dashboard",
                   "pc_apps", "pc_window", "pc_keyboard", "pc_media", "pc_click", "pc_system"],
    },
    "geral": {
        "label": "Generalista",
        "description": "qualquer tarefa de varios passos que misture pesquisa e acoes",
        "skills": None,
    },
    "cerebro": {
        "label": "Cérebro",
        "description": ("Brain Office: segundo cerebro (current-brain), Planner Life, agentes residentes de "
                        "cada setor da vida, lembretes, mural e o retrato da vida do usuario"),
        "skills": "mcp",
    },
    "claude": {
        "label": "Claude",
        "description": ("Claude Code na assinatura do usuario: raciocinio pesado, perguntas sobre codigo e "
                        "projetos locais, analise de arquivos, pesquisa aprofundada (mais lento, mais capaz)"),
        "skills": None,
        "backend": "claude_code",
    },
}

_DELEGATE_DESCRIPTION = (
    "Delega uma tarefa de VARIOS PASSOS pra um agente especializado que roda em segundo plano e "
    "devolve o resultado em texto. Use quando o pedido exigir pesquisar e comparar varias fontes, "
    "encadear acoes no PC, raciocinio pesado ou perguntas sobre codigo/projetos locais (agente "
    "claude). Para pedidos simples de uma ferramenta so, chame a ferramenta direto. Antes de chamar, "
    "avise o usuario em poucas palavras que vai delegar e pra quem."
)

# Painel estruturado na tela do orb (/orb): o agente escolhe o formato. Nao e uma skill do
# registry porque nao executa nada -- so vira um evento live_card pro front renderizar.
_CARD_SCHEMA = {
    "name": "mostrar_na_tela",
    "description": (
        "Mostra um painel estruturado na tela do usuario (o orb), alem do que voce fala. Use quando "
        "a resposta tiver dados que se leem melhor do que se ouvem: listas, comparacoes, numeros, "
        "agenda, passos, ranking. Fale so um resumo curto e deixe o detalhe no painel. Resultados de "
        "ferramentas de dados (MCPs, ler_dados_da_vida, escritorio) JA aparecem sozinhos na tela; "
        "use mostrar_na_tela pra montar uma visao propria (filtrada, comparada, resumida)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "titulo": {"type": "string"},
            "subtitulo": {"type": "string"},
            "tipo": {"type": "string", "enum": ["lista", "tabela", "metricas", "linha_do_tempo", "passos", "texto"]},
            "itens": {
                "type": "array",
                "description": "lista/metricas/linha_do_tempo/passos",
                "items": {
                    "type": "object",
                    "properties": {
                        "titulo": {"type": "string"},
                        "detalhe": {"type": "string"},
                        "valor": {"type": "string", "description": "numero ou destaque (metricas)"},
                        "tag": {"type": "string", "description": "rotulo curto: prioridade, status, categoria"},
                        "quando": {"type": "string", "description": "data/hora (linha_do_tempo)"},
                        "progresso": {"type": "number", "description": "0-100"},
                        "url": {"type": "string"},
                    },
                },
            },
            "colunas": {"type": "array", "items": {"type": "string"}, "description": "cabecalho (tabela)"},
            "linhas": {"type": "array", "items": {"type": "array", "items": {"type": "string"}},
                       "description": "linhas da tabela, na ordem das colunas"},
            "texto": {"type": "string", "description": "corpo (tipo texto); paragrafos separados por linha em branco"},
        },
        "required": ["titulo", "tipo"],
    },
}

# Modo pausa ("espera um minutinho"): o usuario vai falar com outra pessoa. Nada do mic vai pro
# Gemini ate ele dizer uma frase de ativacao, detectada LOCALMENTE (wake_spotter, Vosk offline).
DEFAULT_PAUSE_PHRASES = ["espera um minutinho", "espera um pouco", "espera um minuto", "so um minuto",
                         "so um minutinho", "um momento", "so um momento", "pausa", "aguarda", "segura ai",
                         "ja volto", "me da um minuto", "fica quieto um pouco"]
DEFAULT_WAKE_PHRASES = ["e aí óculos", "hey jarvis", "pode continuar", "sankofa"]
DEFAULT_WAKE_ALIASES = {"hey jarvis": ["em chaves", "ei jarvis"]}
DEFAULT_PAUSE_TIMEOUT_MIN = 30
# frase de pausa so conta em fala curta: "um momento historico pra empresa" nao e pedido de pausa
PAUSE_MAX_WORDS = 8

_PAUSE_SCHEMA = {
    "name": "pausar_conversa",
    "description": (
        "Coloca a conversa em espera: voce para de ouvir ate o usuario dizer a palavra de ativacao. "
        "Use quando o usuario pedir pra esperar/aguardar/pausar porque vai falar com outra pessoa, "
        "atender alguem ou se ausentar (ex: 'espera que vou atender', 'me da um segundo'). Antes de "
        "chamar, responda em no maximo 3 palavras ('Claro, aguardo.')."
    ),
    "parameters": {"type": "object", "properties": {}},
}

CENTRAL_SECTIONS = ["hoje", "agenda", "faculdade", "clientes", "projetos", "pesquisa", "vida", "agentes", "mural"]
_CENTRAL_SCHEMA = {
    "name": "abrir_central",
    "description": (
        "Mostra uma area do Brain Office num painel flutuante por cima do app em que o usuario esta "
        "(so a area pedida, nao a Central inteira): hoje, agenda, faculdade, clientes, projetos, "
        "pesquisa, vida (habitos e notas), agentes (conversar com os setores) ou mural. Use quando ele "
        "pedir pra ver/abrir/mostrar uma dessas areas ('abre minha agenda'). "
        "Pedido pra CONVERSAR/FALAR com um setor ou agente (ex: 'quero falar com o setor de faculdade') "
        "e secao=agentes com agente=<setor>, nao a area de dados do setor. Use 'fechar' pra fechar."
    ),
    "parameters": {"type": "object", "properties": {
        "secao": {"type": "string", "enum": CENTRAL_SECTIONS + ["fechar"]},
        "agente": {"type": "string", "description": "em secao=agentes, o setor a abrir (ex: agenda, clientes)"},
    }, "required": ["secao"]},
}

_paused = threading.Event()
_ctl: dict = {}  # pause/resume da sessao ativa (rodam no event loop deste modulo)

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_task: asyncio.Task | None = None
_lock = threading.Lock()
_status = "idle"


def status() -> str:
    if not is_running():
        return "idle"
    return "paused" if _paused.is_set() else _status


_started_at = 0.0


def seconds_since_start() -> float:
    return time.monotonic() - _started_at if is_running() else 0.0


def is_paused() -> bool:
    return is_running() and _paused.is_set()


def pause(reason: str = "manual"):
    if _loop is not None and is_running() and "pause" in _ctl:
        _loop.call_soon_threadsafe(_ctl["pause"], reason)


def announce(text: str):
    """Recado do sistema (ex.: bateria baixa) falado pela voz do Live em vez do Piper. Durante a
    pausa e descartado: o usuario esta conversando com outra pessoa."""
    if _loop is not None and is_running() and "announce" in _ctl:
        _loop.call_soon_threadsafe(_ctl["announce"], text)


def resume(reason: str = "manual"):
    if _loop is not None and is_running() and "resume" in _ctl:
        _loop.call_soon_threadsafe(_ctl["resume"], reason)


def is_running() -> bool:
    return _task is not None and not _task.done()


def _mcp_tool_names(include_hidden: bool = False) -> list[str]:
    try:
        import mcp_client
        return [t["function"]["name"] for t in mcp_client.get_all_tool_schemas(include_hidden)]
    except Exception:
        return []


def _agent_enabled(agent_id: str, cfg: dict | None = None) -> bool:
    if AGENTS[agent_id].get("skills") == "mcp":
        return bool(_mcp_tool_names())
    if AGENTS[agent_id].get("backend") == "claude_code":
        import claude_code_agent
        return claude_code_agent.is_available((cfg or {}).get("claude_code"))
    return True


def agents_info(cfg: dict | None = None) -> list[dict]:
    return [{"id": k, "label": v["label"], "description": v["description"]}
            for k, v in AGENTS.items() if _agent_enabled(k, cfg)]


def _ensure_loop():
    global _loop, _thread
    with _lock:
        if _loop is not None:
            return
        ready = threading.Event()

        def _run():
            global _loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            _loop = loop
            ready.set()
            loop.run_forever()

        _thread = threading.Thread(target=_run, daemon=True, name="live_agent_loop")
        _thread.start()
        ready.wait(timeout=5)


def start(cfg: dict, on_event) -> bool:
    """Inicia uma sessao live. Retorna False se ja havia uma rodando. Nao bloqueia."""
    global _task, _started_at
    _ensure_loop()
    if is_running():
        return False
    _started_at = time.monotonic()

    def _create():
        global _task
        _task = _loop.create_task(_session_main(cfg, on_event))

    done = threading.Event()
    _loop.call_soon_threadsafe(lambda: (_create(), done.set()))
    done.wait(timeout=5)
    return True


def stop():
    if _loop is None or not is_running():
        return
    _loop.call_soon_threadsafe(_task.cancel)


class _Speaker:
    """Saida de audio 24 kHz pro dispositivo padrao (o alto-falante Bluetooth dos oculos).

    Jitter buffer: o audio do Gemini chega em rajadas pela rede, e tocar cada pedaco assim que
    chega faz o buffer esvaziar no meio da palavra sempre que o proximo atrasa -- a voz "picota".
    So comeca a tocar com PREROLL acumulado; se esvaziar no meio do turno, volta a acumular (uma
    pausa curta e limpa em vez de varios cortes). No fim do turno (end_turn) toca o resto mesmo
    abaixo do pre-roll. clear() corta na hora (barge-in)."""

    PREROLL_SECONDS = 0.25

    def __init__(self):
        import sounddevice as sd
        self._buf = bytearray()
        self._lock = threading.Lock()
        self._playing = False
        self._flush = False
        self._preroll = int(OUT_RATE * self.PREROLL_SECONDS) * 2
        self.underruns = 0
        self.device_underruns = 0
        self.last_audio_at = 0.0
        self.level = 0.0
        # blocos de 40ms e latencia "high": com 20ms/"low" o A2DP/HFP do Windows perde blocos
        self._stream = sd.RawOutputStream(samplerate=OUT_RATE, channels=1, dtype="int16",
                                           blocksize=int(OUT_RATE * 0.04), latency="high",
                                           callback=self._callback)
        self._stream.start()

    def _callback(self, outdata, frames, time_info, status):
        if status and status.output_underflow:
            self.device_underruns += 1
        n = frames * 2
        with self._lock:
            if not self._playing and (len(self._buf) >= self._preroll or (self._flush and self._buf)):
                self._playing = True
            chunk = b""
            if self._playing:
                chunk = bytes(self._buf[:n])
                del self._buf[:n]
                if not self._buf:
                    self._playing = False
                    if self._flush:
                        self._flush = False  # turno terminou de tocar
                    elif len(chunk) < n:
                        self.underruns += 1  # rede nao acompanhou: volta pro pre-roll
        if chunk:
            self.last_audio_at = time.monotonic()
            samples = np.frombuffer(chunk, dtype=np.int16)
            self.level = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2))) / 32768.0
        else:
            self.level = 0.0
        outdata[:len(chunk)] = chunk
        if len(chunk) < n:
            outdata[len(chunk):] = b"\x00" * (n - len(chunk))

    def write(self, data: bytes):
        with self._lock:
            self._buf.extend(data)

    def end_turn(self):
        with self._lock:
            if self._buf:
                self._flush = True

    def clear(self):
        with self._lock:
            self._buf.clear()
            self._playing = False
            self._flush = False

    def busy(self) -> bool:
        with self._lock:
            pending = len(self._buf) > 0 or self._playing
        return pending or (time.monotonic() - self.last_audio_at) < ECHO_TAIL_SECONDS

    def drained(self) -> bool:
        with self._lock:
            return len(self._buf) == 0

    def close(self):
        try:
            self._stream.stop()
            self._stream.close()
        except Exception:
            pass


def _chime(up: bool) -> bytes:
    """Dois toques curtos (24 kHz): subindo = voltei a ouvir; descendo = entrei em pausa."""
    freqs = (660, 990) if up else (880, 587)
    parts = []
    for f in freqs:
        t = np.arange(int(OUT_RATE * 0.09)) / OUT_RATE
        env = np.minimum(1, np.minimum(t, t[::-1]) * 60)
        parts.append((np.sin(2 * np.pi * f * t) * env * 9000).astype(np.int16))
        parts.append(np.zeros(int(OUT_RATE * 0.04), dtype=np.int16))
    return np.concatenate(parts).tobytes()


def _build_tools(allowed: list[str] | None, cfg: dict):
    from google.genai import types
    import skills_registry

    decls = []
    for t in skills_registry.get_all_tools(allowed=allowed):
        fn = t["function"]
        if fn["name"] in _EXCLUDED_TOOLS:
            continue
        params = fn.get("parameters") or {}
        kwargs = {"name": fn["name"], "description": fn.get("description", "")}
        # Gemini rejeita objeto sem properties -- ferramenta sem argumento vai sem schema
        if params.get("properties"):
            kwargs["parameters_json_schema"] = params
        decls.append(types.FunctionDeclaration(**kwargs))
    agents = [a for a in AGENTS if _agent_enabled(a, cfg)]
    delegate_params = {
        "type": "object",
        "properties": {
            "agent": {"type": "string", "enum": agents,
                      "description": "; ".join(f"{a} = {AGENTS[a]['description']}" for a in agents)},
            "task": {"type": "string", "description": "a tarefa completa, com todo o contexto necessario"},
        },
        "required": ["agent", "task"],
    }
    decls.append(types.FunctionDeclaration(
        name="delegate_task", description=_DELEGATE_DESCRIPTION, parameters_json_schema=delegate_params))
    decls.append(types.FunctionDeclaration(
        name=_CARD_SCHEMA["name"], description=_CARD_SCHEMA["description"],
        parameters_json_schema=_CARD_SCHEMA["parameters"]))
    decls.append(types.FunctionDeclaration(name=_PAUSE_SCHEMA["name"], description=_PAUSE_SCHEMA["description"]))
    decls.append(types.FunctionDeclaration(name=_CENTRAL_SCHEMA["name"], description=_CENTRAL_SCHEMA["description"],
                                           parameters_json_schema=_CENTRAL_SCHEMA["parameters"]))
    return [types.Tool(function_declarations=decls)]


def _confirm_rule(cfg: dict) -> str:
    """config.json > live.confirm_actions (padrao true). Desligado, o Jarvis age direto: manda a
    mensagem, desliga/reinicia o PC e aprova pedidos dos agentes sem esperar o "sim" falado."""
    if cfg.get("confirm_actions", True):
        return ("Antes de mandar mensagem em nome do usuario, confirme o texto e o destinatario. Desligar, "
                "reiniciar e suspender sempre pedem confirmacao. Aprovar ou negar pedidos dos agentes do "
                "escritorio so depois do usuario dizer explicitamente.")
    return ("O usuario dispensou confirmacoes: execute direto o que ele pedir, inclusive mandar mensagens, "
            "desligar/reiniciar/suspender o PC (com confirmed=true) e aprovar ou negar pedidos dos agentes, "
            "e diga em poucas palavras o que fez.")


def _system_prompt(cfg: dict) -> str:
    import smart_agent
    base = smart_agent.build_system_prompt(cfg.get("user_name", "Chefe"), cfg.get("user_role", ""),
                                            smart_agent.personas.get(cfg.get("session_id", "wyglass"), "padrao"),
                                            cfg.get("user_context", ""))
    return base + """

MODO LIVE: voce esta numa conversa de voz em tempo real, saindo direto no alto-falante dos oculos
do usuario. Fale como gente fala: frases curtas, sem listas, sem markdown, sem ler URLs em voz
alta. Se for interrompido, pare e responda ao que o usuario disse agora. Quando chamar uma
ferramenta demorada, diga antes algo curto ("deixa comigo", "vou ver isso"). Quando o usuario se
despedir, responda com uma despedida curta e chame end_conversation.

CONTROLE DO PC: voce controla o computador do usuario (ferramentas pc_*): abrir/fechar/focar apps,
janelas, digitar e atalhos, midia e volume, clicar em elementos descritos na tela e sistema. Pedido
de um passo (abre o Spotify, volume 30, pausa) -> chame direto. Sequencia (abre o WhatsApp e manda
"oi" pro Joao) -> encadeie as ferramentas voce mesmo, um passo por vez, ou delegue ao agente
operador. <<CONFIRM_RULE>>

VIDA DO USUARIO: pra perguntas sobre o dia, prazos, tarefas, provas, clientes, habitos ou "o que eu
faco agora", chame ler_dados_da_vida (le os bancos do Brain Office, rapido e sem depender de nada
rodando) antes de responder. Tarefas do Google Tasks: google_tarefas (listar, concluir quando ele
disser que fez/deu ok, reabrir, criar).

BRAIN OFFICE: o usuario tem um escritorio de agentes residentes, um por setor da vida (agenda,
faculdade, pesquisa, projetos, clientes, pessoal, casa). Quando ele pedir pra falar com um setor,
pedir algo que e trabalho de um setor (organizar a agenda, revisar a faculdade, follow-up de
cliente), criar lembrete, ver o mural ou aprovar o que um agente pediu, use a ferramenta
escritorio. Perguntas a um agente demoram: avise "vou passar pro setor X" antes.

TERMINAL (ferramenta terminal): pra programar e construir por voz. Ele navega nas pastas ("entra no
wy-glass", "volta", "o que tem aqui?") e conversa com o Claude Code na pasta atual ("cria uma API de
tarefas", "roda os testes", "explica esse projeto"). Use acao=pedir com as palavras dele; a conversa
daquela pasta continua entre pedidos. O Claude Code trabalha em segundo plano: diga em uma frase que
mandou e siga a conversa; quando terminar, chega um aviso pra voce falar. Nao invente o resultado.

TELA: o usuario ve uma tela (o orb) enquanto fala com voce. Resultados de ferramentas de dados
aparecem nela automaticamente como painel; quando montar uma resposta com listas, numeros,
comparacoes ou passos, chame mostrar_na_tela e fale so o resumo ("coloquei na tela"). Os paineis
abrem flutuando por cima do app em que ele estiver, sem tirar ele do que esta fazendo. Pedido pra
ABRIR/VER uma area ("abre minha agenda") -> abrir_central com a secao. PERGUNTA sobre ela ("o que
tenho hoje?") -> responda falando, usando os dados (o painel com os dados aparece sozinho).

PAUSA: se o usuario pedir pra voce esperar porque vai falar com outra pessoa, responda em no maximo
3 palavras e chame pausar_conversa. Quando ele voltar (a conversa recomeca sozinha), retome de onde
parou sem comentar a pausa, a menos que ele pergunte.""".replace("<<CONFIRM_RULE>>", _confirm_rule(cfg)) + (
        "\n\nVoce tem acesso ao segundo cerebro do usuario (ferramentas mcp__current-brain__*: "
        "contexto, metas, conteudo, repos) e ao Planner Life (mcp__planner-life__*: colecoes e "
        "registros da vida dele). Quando a pergunta for sobre prioridades, metas, o que estudar ou o "
        "que ha de novo pra ele, consulte essas ferramentas em vez de responder de memoria."
        if _mcp_tool_names() else "")


def _execute_tool(name: str, args: dict, cfg: dict) -> str:
    import skills_registry
    import smart_agent

    ctx = {
        "session_id": cfg.get("session_id", "wyglass"),
        "groq_api_key": cfg.get("groq_api_key", ""),
        "tavily_api_key": cfg.get("tavily_api_key", ""),
        "omni_route": cfg.get("gateway"),
        "personas": smart_agent.personas,
        "describe_screen": smart_agent.describe_screen,
        "google_api_key": cfg.get("google_api_key", ""),
        "vision_model": cfg.get("vision_model"),
    }
    if name == "delegate_task":
        agent = AGENTS.get(args.get("agent"), AGENTS["geral"])
        if agent.get("backend") == "claude_code":
            import claude_code_agent
            return claude_code_agent.run_task(args.get("task", ""), cfg.get("claude_code"))
        return smart_agent.run_agent_task(
            task=args.get("task", ""), agent_label=agent["label"], agent_description=agent["description"],
            groq_api_key=ctx["groq_api_key"], tavily_api_key=ctx["tavily_api_key"],
            gateway=ctx["omni_route"], session_id=ctx["session_id"],
            allowed_skills=(_mcp_tool_names(include_hidden=True) + ["escritorio", "ler_dados_da_vida", "google_tarefas"])
            if agent["skills"] == "mcp"
            else agent["skills"])
    result, _ = skills_registry.execute_tool(name, args, ctx)
    return result


async def _session_main(cfg: dict, on_event):
    global _status
    from google import genai
    from google.genai import types
    import audio_capture

    def emit(payload: dict):
        try:
            on_event(payload)
        except Exception as e:
            print(f"[live_agent] on_event falhou: {e}", flush=True)

    def set_status(s: str, detail: str = ""):
        global _status
        _status = s
        emit({"type": "live_state", "status": s, "detail": detail})

    api_key = cfg.get("google_api_key", "")
    if not api_key:
        set_status("error", "google_api_key nao configurada")
        return

    client = genai.Client(api_key=api_key)
    model = cfg.get("model") or DEFAULT_MODEL
    barge_in_rms = float(cfg.get("barge_in_rms", DEFAULT_BARGE_IN_RMS))
    allowed = cfg.get("allowed_skills")
    loop = asyncio.get_running_loop()

    set_status("connecting")
    mic = audio_capture.get_capture_manager()
    speaker, mic_q = None, None
    resume_handle = None
    end_after_drain = False
    mic_level = 0.0
    last_mic_rms = 0.0
    last_level_emit = 0.0
    _paused.clear()
    pause_phrases = cfg.get("pause_phrases") or DEFAULT_PAUSE_PHRASES
    wake_phrases = cfg.get("wake_phrases") or DEFAULT_WAKE_PHRASES
    wake_aliases = {**DEFAULT_WAKE_ALIASES, **(cfg.get("wake_aliases") or {})}
    pause_timeout = float(cfg.get("pause_timeout_min", DEFAULT_PAUSE_TIMEOUT_MIN)) * 60
    spotter = None
    paused_at = 0.0
    live_session = None

    def enter_pause(reason: str):
        nonlocal paused_at
        if _paused.is_set():
            return
        _paused.set()
        paused_at = time.monotonic()
        if speaker is not None:
            speaker.clear()
            speaker.write(_chime(up=False))
            speaker.end_turn()
        # Sem audio_stream_end aqui de proposito: medido em A/B, mandar o fim de stream ao pausar fazia
        # o VAD do Gemini demorar ~9s pra responder o primeiro pedido depois da retomada (sem: ~4s).
        if spotter is not None:
            spotter.reset()
        _log(f"PAUSA ({reason})")
        set_status("paused", "diga: " + " / ".join(wake_phrases[:3]))
        emit({"type": "live_pause", "paused": True, "reason": reason, "wake_phrases": wake_phrases})

    def leave_pause(reason: str):
        if not _paused.is_set():
            return
        _paused.clear()
        if speaker is not None:
            speaker.clear()
            speaker.write(_chime(up=True))
            speaker.end_turn()
        _log(f"RETOMADA ({reason}) apos {time.monotonic() - paused_at:.0f}s")
        set_status("listening")
        emit({"type": "live_pause", "paused": False, "reason": reason})

    def announce_now(text: str):
        if live_session is None or _paused.is_set():
            return
        _log(f"AVISO falado pelo Live: {text[:80]!r}")
        asyncio.create_task(live_session.send_realtime_input(
            text=f"[aviso do sistema, nao e fala do usuario] Avise o usuario em uma frase curta: {text}"))

    _ctl["pause"], _ctl["resume"], _ctl["announce"] = enter_pause, leave_pause, announce_now

    def is_pause_request(text: str) -> bool:
        import wake_spotter
        words = wake_spotter.normalize(text).split()
        if not words or len(words) > PAUSE_MAX_WORDS:
            return False
        return any(wake_spotter.contains_phrase(text, ph, ratio=0.86) for ph in pause_phrases)

    def live_config():
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=_system_prompt(cfg),
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=cfg.get("voice") or DEFAULT_VOICE))),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            tools=_build_tools(allowed, cfg),
            context_window_compression=types.ContextWindowCompressionConfig(sliding_window=types.SlidingWindow()),
            session_resumption=types.SessionResumptionConfig(handle=resume_handle),
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    # inicio de fala pouco sensivel: o eco do alto-falante open-ear que ainda passa
                    # pelo gate nao pode contar como o usuario interrompendo (picote na voz)
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_LOW,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                    silence_duration_ms=int(cfg.get("silence_ms", 600)),
                )),
        )

    async def pump_mic(session):
        nonlocal mic_level, last_level_emit, last_mic_rms
        silence = None
        held = collections.deque(maxlen=BARGE_IN_CHUNKS)  # blocos altos retidos enquanto o modelo fala
        streak = 0
        last_keepalive, last_heard, last_heard_log = 0.0, "", 0.0
        # nivel do eco enquanto o modelo fala (ultimos ~1,5 s): o mic dos oculos capta a propria voz
        # do Jarvis a 5-12 mil de RMS com o volume alto -- um limite fixo de 2500 deixava o eco passar
        # como interrupcao e o Gemini se cortava a cada 2 s
        echo = collections.deque(maxlen=50)
        while True:
            try:
                chunk = await loop.run_in_executor(None, mic_q.get, True, 0.2)
            except queue.Empty:
                continue
            samples = chunk.reshape(-1)
            rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
            last_mic_rms = rms
            mic_level = rms / 32768.0
            if _paused.is_set():
                # nada vai pro Gemini: a conversa com a outra pessoa fica so nesta maquina. So um bloco
                # de SILENCIO a cada KEEPALIVE_S: sem nenhuma entrada o Gemini derrubava a sessao em
                # ~2,5 min ("1008 operation was aborted")
                now = time.monotonic()
                if now - last_keepalive >= KEEPALIVE_S:
                    last_keepalive = now
                    if silence is None or len(silence) != samples.nbytes:
                        silence = b"\x00" * samples.nbytes
                    await session.send_realtime_input(audio=types.Blob(data=silence, mime_type=f"audio/pcm;rate={IN_RATE}"))
                if spotter is not None and spotter.last_text and spotter.last_text != last_heard and now - last_heard_log >= 3:
                    # diagnostico local (so neste arquivo): o que o detector Vosk entendeu do mic dos oculos
                    last_heard, last_heard_log = spotter.last_text, now
                    _log(f"PAUSA ouviu (local): {last_heard[:60]!r}")
                if pause_timeout and time.monotonic() - paused_at > pause_timeout:
                    _log("PAUSA expirou: encerrando a sessao")
                    asyncio.get_running_loop().call_soon(_task.cancel)
                    return
                if spotter is not None:
                    hit = await loop.run_in_executor(None, spotter.feed, samples.tobytes())
                    if hit:
                        leave_pause(f"frase '{hit}'")
                now = time.monotonic()
                if now - last_level_emit >= LEVEL_EVENT_INTERVAL:
                    last_level_emit = now
                    emit({"type": "live_level", "in": round(min(1.0, mic_level * 6), 3), "out": 0})
                continue
            out: list[bytes] = []
            if speaker.busy():
                echo.append(rms)
                echo_level = sorted(echo)[int(len(echo) * 0.8)] if len(echo) >= 10 else 0.0
                limit = max(barge_in_rms, echo_level * ECHO_MARGIN)
                streak = streak + 1 if rms >= limit else 0
                if streak >= BARGE_IN_CHUNKS:
                    # fala sustentada por cima do modelo: manda tambem o que foi retido, senao o
                    # comeco da interrupcao do usuario se perde
                    out = [*held, samples.tobytes()]
                    held.clear()
                else:
                    if rms >= barge_in_rms:
                        held.append(samples.tobytes())
                    if silence is None or len(silence) != samples.nbytes:
                        silence = b"\x00" * samples.nbytes
                    out = [silence]
                    mic_level = 0.0
            else:
                streak = 0
                held.clear()
                echo.clear()
                out = [samples.tobytes()]
            for data in out:
                await session.send_realtime_input(audio=types.Blob(data=data, mime_type=f"audio/pcm;rate={IN_RATE}"))
            now = time.monotonic()
            if now - last_level_emit >= LEVEL_EVENT_INTERVAL:
                last_level_emit = now
                emit({"type": "live_level", "in": round(min(1.0, mic_level * 6), 3),
                      "out": round(min(1.0, speaker.level * 5), 3)})

    async def run_tools(session, function_calls):
        nonlocal end_after_drain
        responses = []
        for fc in function_calls:
            args = dict(fc.args or {})
            emit({"type": "live_tool", "name": fc.name, "args": args, "phase": "start"})
            if fc.name != "pausar_conversa" and not _paused.is_set():
                set_status("working", fc.name)
            if fc.name == "end_conversation":
                end_after_drain = True
            if fc.name == "mostrar_na_tela":
                emit({"type": "live_card", "card": args})
                result, ok = "Painel mostrado na tela do usuario.", True
            elif fc.name == "abrir_central":
                emit({"type": "live_central", "section": args.get("secao", "hoje"), "agent": args.get("agente")})
                result, ok = ("Central fechada." if args.get("secao") == "fechar"
                              else f"Central aberta em {args.get('secao', 'hoje')} na tela do usuario."), True
            elif fc.name == "pausar_conversa":
                asyncio.create_task(_pause_after_drain())
                result, ok = "Conversa em espera. Nao fale mais nada; ela volta quando o usuario disser a palavra de ativacao.", True
            else:
                try:
                    result = await loop.run_in_executor(None, _execute_tool, fc.name, args, cfg)
                    ok = True
                except Exception as e:
                    result, ok = f"Erro: {e}", False
            # data = resultado completo, pro orb renderizar o painel da ferramenta (MCPs, vida, escritorio)
            emit({"type": "live_tool", "name": fc.name, "phase": "end", "ok": ok, "args": args,
                  "result": (result or "")[:280], "data": (result or "")[:60000]})
            responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response={"result": result or "ok"}))
        try:
            await session.send_tool_response(function_responses=responses)
        except Exception as e:
            # sessao encerrada (stop/despedida) enquanto a ferramenta rodava -- nao ha quem receba
            print(f"[live_agent] resposta de ferramenta descartada, sessao fechada: {e!r}", flush=True)

    async def receive(session):
        nonlocal resume_handle
        user_buf, model_buf = "", ""
        while True:
            async for msg in session.receive():
                if msg.session_resumption_update and msg.session_resumption_update.new_handle:
                    resume_handle = msg.session_resumption_update.new_handle
                if msg.go_away is not None:
                    _log("GO_AWAY: servidor pediu renovacao da sessao")
                    return "reconnect"
                if msg.tool_call and msg.tool_call.function_calls:
                    asyncio.create_task(run_tools(session, msg.tool_call.function_calls))
                sc = msg.server_content
                if sc is None:
                    continue
                if sc.interrupted:
                    _log(f"INTERRUPTED mic_rms={last_mic_rms:.0f} limite={barge_in_rms:.0f} "
                         f"falando={speaker.busy()} transcricao_usuario={user_buf[-60:]!r}")
                    speaker.clear()
                    emit({"type": "live_interrupted"})
                    set_status("listening")
                if sc.input_transcription and sc.input_transcription.text and not _paused.is_set():
                    user_buf += sc.input_transcription.text
                    emit({"type": "live_transcript", "role": "user", "text": user_buf, "final": False})
                    if is_pause_request(user_buf):
                        enter_pause(f"frase '{user_buf.strip()[:40]}'")
                        user_buf = ""
                if _paused.is_set():
                    continue  # resposta que ainda chegue do modelo nao toca durante a pausa
                if sc.model_turn:
                    for part in sc.model_turn.parts or []:
                        if part.inline_data and part.inline_data.data:
                            speaker.write(part.inline_data.data)
                            if _status != "speaking":
                                set_status("speaking")
                if sc.output_transcription and sc.output_transcription.text:
                    if user_buf:
                        emit({"type": "live_transcript", "role": "user", "text": user_buf, "final": True})
                        user_buf = ""
                    model_buf += sc.output_transcription.text
                    emit({"type": "live_transcript", "role": "assistant", "text": model_buf, "final": False})
                if sc.generation_complete or sc.turn_complete:
                    speaker.end_turn()  # toca o resto do buffer mesmo abaixo do pre-roll
                if sc.turn_complete:
                    if speaker.underruns or speaker.device_underruns:
                        _log(f"TURNO buffer_vazio={speaker.underruns} falhas_dispositivo={speaker.device_underruns} "
                             f"texto={model_buf[:60]!r}")
                        speaker.underruns = speaker.device_underruns = 0
                    if model_buf:
                        emit({"type": "live_transcript", "role": "assistant", "text": model_buf, "final": True})
                    model_buf = ""
                    if end_after_drain:
                        while not speaker.drained():
                            await asyncio.sleep(0.05)
                        await asyncio.sleep(ECHO_TAIL_SECONDS)
                        return "end"
                    asyncio.create_task(_settle_to_listening())

    async def _settle_to_listening():
        while speaker.busy():
            await asyncio.sleep(0.05)
        if _status == "speaking" and not _paused.is_set():
            set_status("listening")

    async def _pause_after_drain():
        # a frase de pausa costuma ja ter pausado pela transcricao; se a tool chega atrasada, depois
        # do usuario ja ter voltado, pausar de novo seria errado
        if paused_at and time.monotonic() - paused_at < 15:
            return
        # deixa o "claro, aguardo" terminar de tocar antes de fechar o ouvido
        await asyncio.sleep(0.3)
        deadline = time.monotonic() + 6
        while speaker.busy() and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        enter_pause("pedido ao modelo")

    try:
        # abertos aqui dentro (e nao antes do try): cancelar ou falhar o dispositivo de audio
        # durante a abertura ainda precisa cair no finally, senao o status fica preso em
        # "connecting" e o mic do passive_listener nunca e devolvido
        speaker = await loop.run_in_executor(None, _Speaker)
        mic_q = mic.subscribe(maxsize=100)
        try:
            import wake_spotter
            spotter = await loop.run_in_executor(None, wake_spotter.WakeSpotter, wake_phrases, wake_aliases)
        except Exception as e:
            # sem Vosk a pausa ainda funciona; so a volta fica restrita ao botao/painel
            _log(f"detector de ativacao indisponivel: {e!r}")
        fails, started, model_fails = 0, 0.0, 0
        candidates = [model] + [m for m in MODEL_FALLBACKS if m != model]
        while True:
            try:
                async with client.aio.live.connect(model=model, config=live_config()) as session:
                    live_session = session
                    started = time.monotonic()
                    _log(f"SESSAO model={model} voz={cfg.get('voice') or DEFAULT_VOICE} barge_in_rms={barge_in_rms:.0f}")
                    set_status("paused" if _paused.is_set() else "listening")
                    emit({"type": "live_session", "model": model, "voice": cfg.get("voice") or DEFAULT_VOICE})
                    mic_task = asyncio.create_task(pump_mic(session))
                    try:
                        outcome = await receive(session)
                    finally:
                        mic_task.cancel()
                if outcome == "end":
                    break
                set_status("connecting", "renovando sessao")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"[live_agent] sessao caiu: {e!r}", flush=True)
                _log(f"SESSAO CAIU: {e!r}"[:300])
                lived = time.monotonic() - started if started else 0.0
                if lived > 30:
                    fails = 0  # a sessao chegou a funcionar: e queda nova, nao a mesma falha repetida
                started = 0.0
                fails += 1
                err = str(e).lower()
                # erro interno logo no comeco, repetido, no mesmo modelo = o modelo esta quebrado
                # (nao a rede): troca pro proximo da lista em vez de gastar as tentativas nele
                if ("1011" in err or "internal" in err) and lived < 60:
                    model_fails += 1
                else:
                    model_fails = 0
                if model_fails >= MODEL_SWITCH_AFTER and candidates.index(model) + 1 < len(candidates):
                    old_model = model
                    model = candidates[candidates.index(model) + 1]
                    resume_handle = None  # handle de retomada e por modelo
                    model_fails, fails = 0, 0
                    _log(f"MODELO TROCADO: {old_model} com erro interno repetido -> {model}")
                    emit({"type": "live_session", "model": model, "voice": cfg.get("voice") or DEFAULT_VOICE})
                    set_status("connecting", f"{old_model} com falha, trocando para {model}")
                    await asyncio.sleep(1.0)
                    continue
                # 1008 "Requested entity was not found" = o Gemini nao reconhece mais o handle de retomada
                # (expira depois de horas ou de erro interno 1011). Insistir nele prendeu o Live num loop
                # de 16h; descarta e abre sessao nova (perde o contexto, volta a funcionar).
                if resume_handle and ("1008" in err or "not found" in err or fails >= 2):
                    _log("HANDLE DE RETOMADA RECUSADO: abrindo sessao nova sem o contexto anterior")
                    resume_handle = None
                if fails >= MAX_RECONNECT_FAILS:
                    _log(f"DESISTINDO apos {fails} falhas seguidas")
                    set_status("error", f"Gemini Live indisponivel apos {fails} tentativas: {str(e)[:120]}")
                    break
                set_status("connecting", f"reconectando ({fails}/{MAX_RECONNECT_FAILS})")
                await asyncio.sleep(min(30.0, 1.5 * 2 ** (fails - 1)))
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[live_agent] falha ao abrir audio: {e!r}", flush=True)
        set_status("error", f"audio: {e}"[:200])
    finally:
        if mic_q is not None:
            mic.unsubscribe(mic_q)
        if speaker is not None:
            speaker.close()
        set_status("idle")
