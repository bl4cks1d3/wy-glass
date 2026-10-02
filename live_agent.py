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
import queue
import threading
import time

import numpy as np

DEFAULT_MODEL = "gemini-3.8-live"
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
LEVEL_EVENT_INTERVAL = 1 / 15

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
        "description": ("segundo cerebro (current-brain) e Planner Life: contexto e prioridades do usuario, "
                        "metas, trilhas de estudo, conteudo analisado, repos em alta, registros e automacoes"),
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

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_task: asyncio.Task | None = None
_lock = threading.Lock()
_status = "idle"


def status() -> str:
    return _status if is_running() else "idle"


def is_running() -> bool:
    return _task is not None and not _task.done()


def _mcp_tool_names() -> list[str]:
    try:
        import mcp_client
        return [t["function"]["name"] for t in mcp_client.get_all_tool_schemas()]
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
    global _task
    _ensure_loop()
    if is_running():
        return False

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
    Buffer em bytes alimentado pelo stream do modelo; clear() corta na hora (barge-in)."""

    def __init__(self):
        import sounddevice as sd
        self._buf = bytearray()
        self._lock = threading.Lock()
        self.last_audio_at = 0.0
        self.level = 0.0
        self._stream = sd.RawOutputStream(samplerate=OUT_RATE, channels=1, dtype="int16",
                                           blocksize=int(OUT_RATE * 0.02), callback=self._callback)
        self._stream.start()

    def _callback(self, outdata, frames, time_info, status):
        n = frames * 2
        with self._lock:
            chunk = bytes(self._buf[:n])
            del self._buf[:n]
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

    def clear(self):
        with self._lock:
            self._buf.clear()

    def busy(self) -> bool:
        with self._lock:
            pending = len(self._buf) > 0
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
    return [types.Tool(function_declarations=decls)]


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
operador. Antes de mandar mensagem em nome do usuario, confirme o texto e o destinatario. Desligar,
reiniciar e suspender sempre pedem confirmacao.""" + (
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
            allowed_skills=_mcp_tool_names() if agent["skills"] == "mcp" else agent["skills"])
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
    last_level_emit = 0.0

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
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
                    silence_duration_ms=int(cfg.get("silence_ms", 600)),
                )),
        )

    async def pump_mic(session):
        nonlocal mic_level, last_level_emit
        silence = None
        while True:
            try:
                chunk = await loop.run_in_executor(None, mic_q.get, True, 0.2)
            except queue.Empty:
                continue
            samples = chunk.reshape(-1)
            rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
            mic_level = rms / 32768.0
            if speaker.busy() and rms < barge_in_rms:
                if silence is None or len(silence) != samples.nbytes:
                    silence = b"\x00" * samples.nbytes
                data = silence
                mic_level = 0.0
            else:
                data = samples.tobytes()
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
            set_status("working", fc.name)
            if fc.name == "end_conversation":
                end_after_drain = True
            try:
                result = await loop.run_in_executor(None, _execute_tool, fc.name, args, cfg)
                ok = True
            except Exception as e:
                result, ok = f"Erro: {e}", False
            emit({"type": "live_tool", "name": fc.name, "phase": "end", "ok": ok, "result": (result or "")[:280]})
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
                    return "reconnect"
                if msg.tool_call and msg.tool_call.function_calls:
                    asyncio.create_task(run_tools(session, msg.tool_call.function_calls))
                sc = msg.server_content
                if sc is None:
                    continue
                if sc.interrupted:
                    speaker.clear()
                    emit({"type": "live_interrupted"})
                    set_status("listening")
                if sc.input_transcription and sc.input_transcription.text:
                    user_buf += sc.input_transcription.text
                    emit({"type": "live_transcript", "role": "user", "text": user_buf, "final": False})
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
                if sc.turn_complete:
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
        if _status == "speaking":
            set_status("listening")

    try:
        # abertos aqui dentro (e nao antes do try): cancelar ou falhar o dispositivo de audio
        # durante a abertura ainda precisa cair no finally, senao o status fica preso em
        # "connecting" e o mic do passive_listener nunca e devolvido
        speaker = await loop.run_in_executor(None, _Speaker)
        mic_q = mic.subscribe(maxsize=100)
        while True:
            try:
                async with client.aio.live.connect(model=model, config=live_config()) as session:
                    set_status("listening")
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
                set_status("error", str(e)[:200])
                if resume_handle is None:
                    break
                await asyncio.sleep(1.5)
                set_status("connecting", "reconectando")
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
