import asyncio
import json
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
import uvicorn

from bleak import BleakClient, BleakScanner
import actions
import battery
from version import __version__
# audio_capture/passive_listener import sounddevice, which touches COM/WinRT on import
# (PortAudio's Windows device enumeration) — importing them at module load time, before
# bleak's WinRT scanner gets to assert its own MTA apartment, breaks bleak with
# "Thread is configured for Windows GUI but callbacks are not working". Import lazily,
# after BLE has already connected once, same pattern already used for `jarvis` elsewhere
# in this codebase for the analogous onnxruntime/DLL conflict.

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"

MULTI_CLICK_WINDOW = 0.8   # seconds to wait for additional clicks of the same button
                            # (raised from 0.45s — live testing showed a real double-click on
                            # the physical button landing ~780ms apart, with margin to spare)

BATTERY_POLL_INTERVAL = 120  # seconds — battery.read_battery_percent() shells out to
                              # powershell and takes ~1-2s, so this stays well clear of that cost
BATTERY_WARN_HYSTERESIS = 5   # % above the threshold required before a new low-battery
                              # warning can fire again, so it doesn't re-trigger every poll
                              # while sitting right at the threshold


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


class ButtonCounter:
    def __init__(self, button_key: str):
        self.button_key = button_key
        self.count = 0
        self.pending_task = None
        self.last_raw = ""


class State:
    def __init__(self):
        self.config = load_config()
        self.connected = False
        self.connected_at = None
        self.websockets: set[WebSocket] = set()
        self.client: BleakClient | None = None
        self.ble_task = None
        self.counters = {"button1": ButtonCounter("button1"), "button2": ButtonCounter("button2")}
        self.conversation_active = False
        self.conversation_task = None
        self.battery_percent: int | None = None
        self.battery_low_warned = False
        self.loop: asyncio.AbstractEventLoop | None = None


state = State()
app = FastAPI()


def _passive_listener():
    import passive_listener
    return passive_listener


def _audio_capture():
    import audio_capture
    return audio_capture


def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


async def broadcast(payload: dict):
    dead = set()
    for ws in state.websockets:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.add(ws)
    state.websockets -= dead


NINE_ROUTER_DEFAULT_URL = "http://localhost:20128/v1"


def effective_gateway() -> dict:
    """Gateway LLM OpenAI-compatible usado pelos agentes de texto (smart_agent.ask_groq). 9router
    (config.json > nine_router) tem precedencia sobre OmniRoute quando os dois estao ligados —
    os dois escutam por padrao na mesma porta 20128, entao na pratica so um roda por vez. Devolve
    no formato que ask_groq ja entende (o antigo campo omni_route), com base_url ja apontando pro
    endpoint de chat completions."""
    nr = state.config.get("nine_router") or {}
    if nr.get("enabled"):
        base = (nr.get("base_url") or NINE_ROUTER_DEFAULT_URL).rstrip("/")
        if not base.endswith("/chat/completions"):
            base += "/chat/completions"
        return {"enabled": True, "provider": "9router", "base_url": base,
                "api_key": nr.get("api_key", ""), "model": nr.get("model") or "auto"}
    omni = dict(state.config.get("omni_route") or {})
    if omni.get("enabled"):
        omni["provider"] = "omniroute"
    return omni


async def run_action_async(action_type: str, params: dict) -> str:
    # Credentials (Groq/Tavily/Gemini keys) are glasses-wide capabilities, not
    # tied to any one gesture — merged in here so every action sees them
    # without each gesture having to repeat the same key in its own params.
    # A gesture's own params still win on collision (explicit override).
    merged = {
        **state.config.get("user_profile", {}),
        **state.config.get("credentials", {}),
        "omni_route": effective_gateway(),
        "enabled_skills": state.config.get("enabled_skills"),  # None = todas habilitadas
        **params,
    }
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, actions.run_action, action_type, merged)


def _speak_blocking(text: str, tts_model: str):
    """import + fala juntos numa so chamada, sempre disparada via run_in_executor — nunca
    direto na thread do event loop. jarvis.py importa sounddevice, e a inicializacao do
    WASAPI/PortAudio no Windows prende a THREAD QUE FEZ O IMPORT em COM modo STA ("Thread is
    configured for Windows GUI"); se isso acontecer na thread do event loop asyncio, toda
    reconexao BLE seguinte quebra (bleak exige MTA nessa mesma thread pro scanner WinRT). Mesma
    causa raiz documentada em passive_listener.py._run()."""
    import jarvis
    jarvis.speak(text, tts_model)


def _pop_end_requested(session_id: str) -> bool:
    """Mesmo motivo do _speak_blocking acima: import de smart_agent (que importa jarvis ->
    sounddevice) sempre dentro de uma chamada por run_in_executor, nunca solto na thread do
    event loop."""
    import smart_agent
    return smart_agent.end_requested.pop(session_id, False)


def _stop_speaking_blocking():
    import jarvis
    jarvis.stop_speaking()


async def stop_conversation(gesture_key: str, raw_hex: str):
    # Corta a fala em andamento na hora, independente de ter conversa ativa ou nao — clique no
    # botao 2 durante a reproducao interrompe o TTS imediatamente, em vez de esperar a frase
    # inteira terminar antes de fazer efeito.
    if _live_running():
        await stop_live()
        await broadcast({"type": "gesture", "gesture": gesture_key, "label": "Encerrar modo live",
                          "raw": raw_hex, "time": ts(), "note": ""})
        return
    await asyncio.get_event_loop().run_in_executor(None, _stop_speaking_blocking)
    was_active = state.conversation_active
    state.conversation_active = False
    await broadcast({
        "type": "gesture", "gesture": gesture_key,
        "label": state.config["gestures"].get(gesture_key, {}).get("label", gesture_key),
        "raw": raw_hex, "time": ts(), "note": "",
    })
    if not was_active:
        await broadcast({"type": "action_result", "gesture": gesture_key, "ok": True,
                          "message": "nenhuma conversa ativa", "time": ts()})
        return
    await broadcast({"type": "conversation", "status": "ending"})
    gcfg = state.config["gestures"].get(gesture_key, {})
    farewell = gcfg.get("params", {}).get("farewell_text", "")
    tts_model = gcfg.get("params", {}).get("tts_model", "pt_BR-faber-medium.onnx")
    if farewell and state.config.get("actions_enabled", False):
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _speak_blocking, farewell, tts_model)
        except Exception as e:
            await broadcast({"type": "action_result", "gesture": gesture_key, "ok": False, "message": str(e), "time": ts()})


async def conversation_loop(gesture_key: str, gcfg: dict):
    state.conversation_active = True
    await broadcast({"type": "conversation", "status": "started"})
    _passive_listener().pause()  # don't let wake word / clap detection compete for the mic
    loop = asyncio.get_event_loop()
    # session_id do open_jarvis_agent — usado pra checar se o proprio modelo pediu pra encerrar
    # (usuario se despediu por voz), ver smart_agent.end_requested
    session_id = gcfg.get("params", {}).get("session_id")
    try:
        while state.conversation_active:
            try:
                result = await run_action_async(gcfg["action"], gcfg.get("params", {}))
                await broadcast({"type": "action_result", "gesture": gesture_key, "ok": True, "message": result, "time": ts()})
            except Exception as e:
                await broadcast({"type": "action_result", "gesture": gesture_key, "ok": False, "message": str(e), "time": ts()})
                break
            if session_id and await loop.run_in_executor(None, _pop_end_requested, session_id):
                break
    finally:
        _passive_listener().resume()
    state.conversation_active = False
    await broadcast({"type": "conversation", "status": "ended"})


LIVE_BUTTON_GRACE_S = 5.0

# acoes de gesto que gravam pelo mic e falam pelo Piper -- bloqueadas enquanto o Live roda
_PIPER_ACTIONS = {"open_jarvis_agent", "jarvis_voice_agent", "translator_agent", "voice_command"}


def _live_agent():
    import live_agent
    return live_agent


def _live_cfg(overrides: dict | None = None) -> dict:
    """Monta a config da sessao live: credenciais globais + config.json > live + params do gesto
    que disparou (overrides), nessa ordem de precedencia crescente."""
    creds = state.config.get("credentials", {})
    profile = state.config.get("user_profile", {})
    return {
        "google_api_key": creds.get("google_api_key", ""),
        "groq_api_key": creds.get("groq_api_key", ""),
        "tavily_api_key": creds.get("tavily_api_key", ""),
        "gateway": effective_gateway(),
        "user_name": profile.get("user_name", "Chefe"),
        "user_role": profile.get("user_role", ""),
        "user_context": profile.get("user_context", ""),
        "allowed_skills": state.config.get("enabled_skills"),
        "claude_code": state.config.get("claude_code") or {},
        **(state.config.get("live") or {}),
        **(overrides or {}),
    }


def _on_live_event(payload: dict):
    """Chamado da thread do live_agent — repassa pro event loop principal."""
    if payload.get("type") == "live_state" and payload.get("status") == "idle":
        _passive_listener().resume()
    if payload.get("type") == "live_pause":
        # Na pausa do Live o "hey jarvis" do openWakeWord (o mesmo da escuta passiva, que ja funciona
        # com o mic Bluetooth dos oculos) volta a escutar -- e o disparo retoma o Live (fire_gesture).
        # Fora da pausa ele fica desligado: o Live ja esta ouvindo tudo.
        if payload.get("paused"):
            _passive_listener().resume()
        else:
            _passive_listener().pause()
    asyncio.run_coroutine_threadsafe(broadcast(payload), state.loop)


def _start_live_blocking(cfg: dict) -> bool:
    # sempre via run_in_executor: live_agent puxa audio_capture/sounddevice (mesma razao de
    # _speak_blocking — nunca importar isso na thread do event loop)
    import jarvis
    jarvis.stop_speaking()  # corta qualquer fala do Piper em andamento antes do Live comecar a falar
    _passive_listener().pause()
    started = _live_agent().start(cfg, _on_live_event)
    if not started:
        _passive_listener().resume()
    return started


async def start_live(overrides: dict | None = None) -> bool:
    state.conversation_active = False  # live substitui o modo conversa classico
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _start_live_blocking, _live_cfg(overrides))


async def stop_live():
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: _live_agent().stop())


def _live_running() -> bool:
    mod = sys.modules.get("live_agent")
    return bool(mod and mod.is_running())


async def fire_gesture(gesture_key: str, raw_hex: str, note: str = ""):
    gcfg = state.config["gestures"].get(gesture_key)

    if gcfg and gcfg.get("action") == "stop_conversation":
        await stop_conversation(gesture_key, raw_hex)
        return

    label = gcfg["label"] if gcfg else gesture_key
    await broadcast({
        "type": "gesture", "gesture": gesture_key, "label": label,
        "raw": raw_hex, "time": ts(), "note": note,
    })
    if not gcfg:
        return
    if not state.config.get("actions_enabled", False):
        await broadcast({"type": "action_result", "gesture": gesture_key, "ok": True,
                          "message": "modo teste — acao nao executada", "time": ts()})
        return

    if gesture_key == "button1_single" and _live_running():
        mod = _live_agent()
        if mod.seconds_since_start() < LIVE_BUTTON_GRACE_S:
            # clique logo depois de ligar o Live (ou o 3o clique de um duplo) pausava a sessao na
            # largada -- "o Live nao funciona"; ignora nos primeiros segundos
            return
        if mod.is_paused():
            mod.resume("botao")
        else:
            mod.pause("botao")
        await broadcast({"type": "gesture", "gesture": gesture_key, "label": "Pausa do Live (botao)",
                          "raw": raw_hex, "time": ts(), "note": note})
        return

    if _live_running() and raw_hex == "(escuta passiva)":
        mod = _live_agent()
        if mod.is_paused():
            mod.resume("hey jarvis (openWakeWord)")
        return  # Live ativo: a escuta passiva so serve pra sair da pausa

    if _live_running() and gcfg.get("action") in _PIPER_ACTIONS:
        # usam o Piper e o mic por conta propria: rodar durante o Live = duas vozes ao mesmo tempo
        await broadcast({"type": "action_result", "gesture": gesture_key, "ok": False,
                          "message": "ignorado: modo Live ativo (encerre o Live pra usar este gesto)", "time": ts()})
        return

    if gcfg.get("action") == "live_agent":
        if _live_running():
            await stop_live()
        else:
            await start_live(gcfg.get("params"))
        return

    if gcfg.get("params", {}).get("conversation_mode"):
        if state.conversation_task is not None and not state.conversation_task.done():
            return  # conversation already running
        state.conversation_task = asyncio.create_task(conversation_loop(gesture_key, gcfg))
        return

    _passive_listener().pause()
    try:
        result = await run_action_async(gcfg["action"], gcfg.get("params", {}))
        await broadcast({"type": "action_result", "gesture": gesture_key, "ok": True, "message": result, "time": ts()})
    except Exception as e:
        await broadcast({"type": "action_result", "gesture": gesture_key, "ok": False, "message": str(e), "time": ts()})
    finally:
        _passive_listener().resume()


async def dispatch_multiclick(button_key: str, loop):
    await asyncio.sleep(MULTI_CLICK_WINDOW)
    counter = state.counters[button_key]
    count = counter.count
    raw_hex = counter.last_raw
    counter.count = 0
    suffix = {1: "single", 2: "double", 3: "triple"}.get(count)
    if suffix is None:
        return  # 4+ rapid clicks: ignore, ambiguous
    await fire_gesture(f"{button_key}_{suffix}", raw_hex)


def classify_button(b: bytes):
    """Returns 'button1' / 'button2' if b is a bc0303 per-button click event, else None."""
    if len(b) == 6 and b[0:4] == bytes.fromhex("bc030301") and b[4] == b[5] and b[4] in (1, 2):
        return f"button{b[4]}"
    return None


def notification_handler(loop: asyncio.AbstractEventLoop):
    def handler(sender, data: bytearray):
        b = bytes(data)
        raw_hex = b.hex()
        asyncio.run_coroutine_threadsafe(broadcast({"type": "raw", "hex": raw_hex, "time": ts()}), loop)

        button_key = classify_button(b)
        if button_key is None:
            return  # heartbeat (bc07..), telemetry (bc09..), or unrecognized — never a click

        print(f"[{ts()}] CLICK {button_key} {raw_hex}", flush=True)
        counter = state.counters[button_key]
        counter.count += 1
        counter.last_raw = raw_hex
        if counter.pending_task is not None and not counter.pending_task.done():
            counter.pending_task.cancel()
        counter.pending_task = asyncio.run_coroutine_threadsafe(dispatch_multiclick(button_key, loop), loop)

    return handler


def _on_passive_trigger(loop, gesture_key: str, note: str):
    asyncio.run_coroutine_threadsafe(
        fire_gesture(gesture_key, raw_hex="(escuta passiva)", note=note), loop
    )


def _connect_greeting_blocking(user_name: str, tts_model: str, session_id: str):
    """import + fala + marcar sessao, tudo numa chamada so — mesmo motivo do _speak_blocking
    acima (jarvis e smart_agent ambos importam jarvis.py -> sounddevice; isso tem que acontecer
    numa worker thread do executor, nunca na thread do event loop)."""
    import jarvis
    import smart_agent
    greeting = smart_agent.greeting_text(user_name)
    jarvis.speak(greeting, tts_model, during_live="skip")
    # marca a sessao como ja iniciada, senao o primeiro clique real repetiria a mesma saudacao
    # de novo (open_jarvis_agent so cumprimenta se a sessao ainda nao existir)
    smart_agent.conversations.setdefault(session_id, [])


async def _speak_connect_greeting(loop):
    """Falado toda vez que a conexao BLE sobe (primeira vez ou apos reconectar) — mesma saudacao
    deterministica (sem chamada ao Groq) ja usada em smart_agent.greeting_text() na ativacao por
    voz, reaproveitada aqui como confirmacao audivel de "oculos conectados" sem precisar apertar
    nenhum botao. Roda como task solta (nao bloqueia start_notify logo em seguida)."""
    if not state.config.get("actions_enabled", False):
        return
    try:
        gcfg = state.config.get("gestures", {}).get("button1_single", {}).get("params", {})
        session_id = gcfg.get("session_id", "wyglass")
        user_name = gcfg.get("user_name") or state.config.get("user_profile", {}).get("user_name", "Chefe")
        tts_model = gcfg.get("tts_model", "pt_BR-faber-medium.onnx")
        await loop.run_in_executor(None, _connect_greeting_blocking, user_name, tts_model, session_id)
    except Exception as e:
        print(f"[ble_manager] erro na saudacao de conexao: {e}", flush=True)


async def ble_manager():
    loop = asyncio.get_event_loop()
    while True:
        try:
            address = state.config["device_address"]
            await broadcast({"type": "status", "connected": False, "message": f"escaneando {address}..."})
            device = await BleakScanner.find_device_by_address(address, timeout=15.0)
            target = device if device else address

            disconnected = asyncio.Event()

            async with BleakClient(target, disconnected_callback=lambda c: loop.call_soon_threadsafe(disconnected.set)) as client:
                state.client = client
                state.connected = True
                state.connected_at = time.monotonic()
                await broadcast({"type": "status", "connected": True, "message": "conectado"})
                asyncio.create_task(_speak_connect_greeting(loop))

                # Started only after BLE's first successful WinRT/MTA init, not at process
                # startup — sd.InputStream's own thread racing bleak's WinRT scanner during
                # startup was breaking bleak with "Thread is configured for Windows GUI but
                # callbacks are not working" (COM apartment conflict). start() is idempotent,
                # so this is a no-op on reconnects.
                _passive_listener().start(lambda: state.config, lambda gk, note: _on_passive_trigger(loop, gk, note))

                # client.services e uma propriedade (nao metodo/coroutine) nas versoes atuais do
                # bleak -- ja populada automaticamente por connect(), sem chamada explicita. Se a
                # characteristic nao aparecer, o log abaixo mostra o que FOI encontrado (em vez
                # do BleakCharacteristicNotFoundError generico), o que ajuda a diferenciar "ainda
                # nao pareado" de "UUID errado".
                notify_uuid = state.config["notify_char_uuid"]
                services = client.services
                if services is None or services.get_characteristic(notify_uuid) is None:
                    found = [c.uuid for s in services for c in s.characteristics] if services else []
                    raise RuntimeError(
                        f"characteristic {notify_uuid} nao encontrada apos descoberta de "
                        f"servicos (encontradas: {found or 'nenhuma'}) -- no Linux, tente parear "
                        f"manualmente primeiro: 'bluetoothctl' -> pair/trust/connect no endereco "
                        f"{address}, depois rode o servidor de novo"
                    )

                await client.start_notify(notify_uuid, notification_handler(loop))
                await disconnected.wait()

                state.connected = False
                await broadcast({"type": "status", "connected": False, "message": "desconectado, reconectando..."})

        except Exception as e:
            state.connected = False
            await broadcast({"type": "status", "connected": False, "message": f"erro: {e}"})
            traceback.print_exc()
            await asyncio.sleep(5)
            continue
        await asyncio.sleep(2)


def _check_groq_models(api_key: str) -> list[str]:
    """Confere se os modelos Groq fixados no codigo (smart_agent.GROQ_TEXT_MODEL/
    GROQ_VISION_MODEL) ainda existem na conta. A Groq ja aposentou modelo sem aviso (see_screen
    ficou quebrado silenciosamente por um tempo ate alguem notar) — melhor descobrir num log de
    startup/healthcheck do que só quando o usuario tentar usar a funcao de verdade."""
    import requests
    import smart_agent
    resp = requests.get(
        "https://api.groq.com/openai/v1/models",
        headers={"Authorization": f"Bearer {api_key}"}, timeout=10,
    )
    resp.raise_for_status()
    available = {m["id"] for m in resp.json().get("data", [])}
    wanted = {smart_agent.GROQ_TEXT_MODEL, smart_agent.GROQ_VISION_MODEL}
    return sorted(wanted - available)


async def groq_model_healthcheck():
    """Roda pouco depois do startup (dando tempo do servidor terminar de subir) e depois a cada
    6h. So loga/avisa no Dashboard — nunca derruba nada, so evita descoberta tardia."""
    await asyncio.sleep(30)
    loop = asyncio.get_event_loop()
    while True:
        try:
            groq_key = state.config.get("credentials", {}).get("groq_api_key", "")
            if groq_key:
                missing = await loop.run_in_executor(None, _check_groq_models, groq_key)
                if missing:
                    msg = (f"modelo(s) Groq configurado(s) no codigo nao encontrados na conta: "
                           f"{', '.join(missing)} — pode ter sido descontinuado, ver smart_agent.py")
                    print(f"[healthcheck] {msg}", flush=True)
                    await broadcast({"type": "action_result", "gesture": "healthcheck",
                                      "ok": False, "message": msg, "time": ts()})
        except Exception as e:
            print(f"[healthcheck] erro ao checar modelos Groq: {e}", flush=True)
        await asyncio.sleep(6 * 3600)


async def battery_monitor():
    """Poll periodico do nivel de bateria (ver battery.py — cache do Windows, HFP, nao BLE).
    Roda independente de state.connected: o Windows guarda esse valor pela conexao Bluetooth
    classica, que sobrevive a ciclos de conexao/reconexao do nosso canal BLE proprio."""
    loop = asyncio.get_event_loop()
    while True:
        try:
            address = state.config["device_address"]
            percent = await loop.run_in_executor(None, battery.read_battery_percent, address)
            if percent is None and sys.platform == "win32":
                # noutras plataformas isso e permanente (sem equivalente Linux implementado,
                # ver battery.py) — repetir esse aviso a cada BATTERY_POLL_INTERVAL pra sempre
                # so faria log noise; no Windows ainda vale avisar (pode ser so cache vazio)
                print("[battery] leitura falhou (Windows sem esse dado ainda?)", flush=True)
            if percent is not None and percent != state.battery_percent:
                state.battery_percent = percent
                threshold = state.config.get("battery_low_threshold", 20)
                is_low = percent <= threshold
                await broadcast({"type": "battery", "percent": percent, "low": is_low, "time": ts()})

                if is_low and not state.battery_low_warned:
                    state.battery_low_warned = True
                    msg = f"Bateria dos óculos em {percent}%. Recarregue em breve."
                    print(f"[battery] {msg}", flush=True)
                    await broadcast({"type": "action_result", "gesture": "battery",
                                      "ok": False, "message": msg, "time": ts()})
                    if state.config.get("actions_enabled", False):
                        gcfg = state.config.get("gestures", {}).get("button1_single", {}).get("params", {})
                        tts_model = gcfg.get("tts_model", "pt_BR-faber-medium.onnx")
                        try:
                            await loop.run_in_executor(None, _speak_blocking, msg, tts_model)
                        except Exception as e:
                            print(f"[battery] erro ao avisar por voz: {e}", flush=True)
                elif percent > threshold + BATTERY_WARN_HYSTERESIS:
                    state.battery_low_warned = False
        except Exception as e:
            print(f"[battery] erro ao ler bateria: {e}", flush=True)
        await asyncio.sleep(BATTERY_POLL_INTERVAL)


@app.on_event("startup")
async def startup():
    state.loop = asyncio.get_event_loop()
    import office_notifier
    office_notifier.start(_on_office_nudge)
    state.ble_task = asyncio.create_task(ble_manager())
    asyncio.create_task(groq_model_healthcheck())
    asyncio.create_task(battery_monitor())
    # Conecta nos servidores MCP configurados (config.json > mcp_servers) — roda no proprio
    # loop asyncio do mcp_client (thread dedicada, ver mcp_client.py), entao nao bloqueia o
    # startup do resto do servidor mesmo se um servidor MCP demorar/falhar pra conectar.
    loop = asyncio.get_event_loop()
    mcp_servers = state.config.get("mcp_servers", [])
    if mcp_servers:
        import mcp_client
        loop.run_in_executor(None, mcp_client.connect_configured_servers, mcp_servers)


@app.on_event("shutdown")
async def shutdown():
    if _live_running():
        await stop_live()
    _passive_listener().stop()
    _audio_capture().get_capture_manager().stop()
    try:
        import mcp_client
        mcp_client.disconnect_all()
    except Exception:
        pass
    try:
        import browser_tools
        browser_tools.close()
    except ImportError:
        pass


# paginas mudam a cada deploy local -- sem isso o navegador serve a versao velha do cache
_NO_CACHE = {"Cache-Control": "no-cache"}


@app.get("/", response_class=HTMLResponse)
async def landing():
    return FileResponse(BASE_DIR / "static" / "landing.html", headers=_NO_CACHE)


@app.get("/orb", response_class=HTMLResponse)
async def orb_page():
    return FileResponse(BASE_DIR / "static" / "orb.html", headers=_NO_CACHE)


@app.get("/static/{name}")
async def static_file(name: str):
    static_dir = (BASE_DIR / "static").resolve()
    path = (static_dir / name).resolve()
    if path.parent != static_dir or not path.is_file():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(path, headers=_NO_CACHE)


@app.get("/deck", response_class=HTMLResponse)
async def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/test", response_class=HTMLResponse)
async def test_page():
    return FileResponse(BASE_DIR / "static" / "test.html")


@app.get("/api/config")
async def get_config():
    return state.config


@app.post("/api/config")
async def set_config(new_config: dict):
    state.config.update(new_config)
    save_config(state.config)
    return {"ok": True}


@app.post("/api/actions_enabled")
async def set_actions_enabled(body: dict):
    state.config["actions_enabled"] = bool(body.get("enabled", False))
    save_config(state.config)
    await broadcast({"type": "actions_enabled", "enabled": state.config["actions_enabled"]})
    return {"ok": True}


@app.get("/api/status")
async def get_status():
    return {"connected": state.connected, "device_address": state.config["device_address"],
             "device_name": state.config.get("device_name"), "firmware": state.config.get("firmware"),
             "actions_enabled": state.config.get("actions_enabled", False), "app_version": __version__,
             "battery_percent": state.battery_percent,
             "battery_low_threshold": state.config.get("battery_low_threshold", 20)}


@app.post("/api/test/{gesture_key}")
async def test_gesture(gesture_key: str):
    await fire_gesture(gesture_key, raw_hex="(teste manual)")
    return {"ok": True}


@app.get("/api/skills")
async def get_skills():
    """Lista todas as ferramentas do harness (skills locais em skills/*.py + qualquer servidor
    MCP conectado — ver skills_registry.py/mcp_client.py), junto com se cada uma esta habilitada
    globalmente (config.json > enabled_skills; None/ausente = todas habilitadas, igual ao
    comportamento de sempre). Usado pela aba FERRAMENTAS do dashboard."""
    import skills_registry
    enabled = state.config.get("enabled_skills")
    tools = skills_registry.get_all_tools()
    return {
        "skills": [
            {
                "name": t["function"]["name"],
                "description": t["function"]["description"],
                "enabled": enabled is None or t["function"]["name"] in enabled,
                "generated": skills_registry.is_generated(t["function"]["name"]),
            }
            for t in tools
        ],
        "all_enabled": enabled is None,
        "action_types": skills_registry._ACTION_TYPES,
    }


@app.post("/api/skills/create")
async def create_skill(body: dict):
    """Cria uma skill nova a partir do formulario da aba FERRAMENTAS — nunca executa codigo
    escrito pelo usuario, so gera um arquivo skills/*.py que delega pra uma acao ja existente
    e vetada em actions.py (ver skills_registry.create_skill)."""
    import skills_registry
    try:
        filename = skills_registry.create_skill(
            name=body.get("name", ""),
            description=body.get("description", ""),
            action_type=body.get("action_type", ""),
            static_params=body.get("static_params", {}),
            model_params=body.get("model_params", []),
        )
        return {"ok": True, "filename": filename}
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.post("/api/skills/delete")
async def delete_skill(body: dict):
    import skills_registry
    try:
        skills_registry.delete_skill(body.get("name", ""))
        return {"ok": True}
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@app.get("/api/live")
async def live_status():
    mod = sys.modules.get("live_agent")
    live_cfg = state.config.get("live") or {}
    gw = effective_gateway()
    return {
        "running": _live_running(),
        "status": mod.status() if mod else "idle",
        "paused": bool(mod and mod.is_paused()),
        "wake_phrases": live_cfg.get("wake_phrases") or ["e aí óculos", "hey jarvis", "pode continuar", "sankofa"],
        "model": live_cfg.get("model") or "gemini-3.8-live",
        "voice": live_cfg.get("voice") or "Charon",
        "gateway": {"provider": gw.get("provider", "groq") if gw.get("enabled") else "groq",
                     "model": gw.get("model") if gw.get("enabled") else "openai/gpt-oss-20b"},
        "agents": _live_agent().agents_info({"claude_code": state.config.get("claude_code") or {}}),
    }


@app.post("/api/live/start")
async def live_start(body: dict | None = None):
    if not state.config.get("credentials", {}).get("google_api_key"):
        return JSONResponse({"ok": False, "error": "configure credentials.google_api_key"}, status_code=400)
    started = await start_live(body or {})
    return {"ok": True, "already_running": not started}


@app.post("/api/live/pause")
async def live_pause():
    if not _live_running():
        return JSONResponse({"ok": False, "error": "o Live nao esta ativo"}, status_code=409)
    _live_agent().pause("painel")
    return {"ok": True}


@app.post("/api/live/resume")
async def live_resume():
    if not _live_running():
        return JSONResponse({"ok": False, "error": "o Live nao esta ativo"}, status_code=409)
    _live_agent().resume("painel")
    return {"ok": True}


def _record_and_transcribe(seconds: float) -> str:
    import audio_capture
    import queue as _queue
    import wake_spotter
    mic = audio_capture.get_capture_manager()
    q = mic.subscribe(maxsize=400)
    chunks, deadline = [], time.monotonic() + seconds
    try:
        while time.monotonic() < deadline:
            try:
                chunks.append(q.get(timeout=0.3).reshape(-1).tobytes())
            except _queue.Empty:
                pass
    finally:
        mic.unsubscribe(q)
    return wake_spotter.transcribe(b"".join(chunks))


@app.post("/api/live/wake/calibrate")
async def wake_calibrate(body: dict):
    """Grava ~3s do mic dos oculos com o usuario dizendo a frase e guarda "como o Vosk ouve" como
    apelido dela -- e o que faz palavras fora do vocabulario (nomes, ingles) funcionarem."""
    phrase = (body.get("phrase") or "").strip()
    if not phrase:
        return JSONResponse({"ok": False, "error": "frase vazia"}, status_code=400)
    loop = asyncio.get_event_loop()
    try:
        heard = await loop.run_in_executor(None, _record_and_transcribe, float(body.get("seconds", 3)))
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"falha na gravacao: {e}"}, status_code=500)
    if not heard.strip():
        return {"ok": False, "heard": "", "error": "nao ouvi nada; fale mais perto do microfone"}
    import wake_spotter
    live_cfg = state.config.setdefault("live", {})
    aliases = live_cfg.setdefault("wake_aliases", {})
    known = aliases.setdefault(phrase, [])
    if wake_spotter.contains_phrase(heard, phrase):
        return {"ok": True, "heard": heard, "added": False, "note": "ja reconhece essa frase do jeito que voce fala"}
    if heard not in known:
        known.append(heard)
        save_config(state.config)
    return {"ok": True, "heard": heard, "added": True, "aliases": known}


@app.post("/api/live/stop")
async def live_stop():
    await stop_live()
    return {"ok": True}


# Central do orb (static/orb-central.js): as areas do Brain Office dentro do oculos. So estas rotas
# passam -- mexer em configuracao, servicos ou permissoes do escritorio continua so no painel dele.
_OFFICE_ALLOWED = (
    ("GET", r"^/hoje$"), ("GET", r"^/local/planner$"), ("GET", r"^/local/brain/[a-z]+$"),
    ("GET", r"^/local/notes$"), ("GET", r"^/local/note$"), ("GET", r"^/agents$"),
    ("GET", r"^/agents/[a-z0-9-]+/chat$"), ("GET", r"^/board$"), ("GET", r"^/reminders$"),
    ("GET", r"^/briefs$"), ("GET", r"^/permissions$"),
    ("POST", r"^/local/planner/(tasks|habits|clients|projects|topics)$"),
    ("PATCH", r"^/local/planner/(tasks|habits|clients|projects|topics|messages)/[A-Za-z0-9@._-]+$"),
    ("POST", r"^/agents/[a-z0-9-]+/messages$"), ("POST", r"^/route$"), ("POST", r"^/reminders$"),
    ("POST", r"^/local/brain/(state|step|milestone|feedback)/[A-Za-z0-9-]+$"),
)


@app.api_route("/api/office/{path:path}", methods=["GET", "POST", "PATCH"])
async def office_proxy(path: str, request: Request):
    import re
    import brain_office
    sub = "/" + path
    if not any(m == request.method and re.match(rx, sub) for m, rx in _OFFICE_ALLOWED):
        return JSONResponse({"error": f"rota nao liberada pra central: {request.method} {sub}"}, status_code=403)
    loop = asyncio.get_event_loop()
    if not await loop.run_in_executor(None, brain_office.is_up):
        return JSONResponse({"error": "Brain Office desligado", "down": True}, status_code=503)
    body = None
    if request.method != "GET":
        try:
            body = await request.json()
        except Exception:
            body = {}
    params = dict(request.query_params)
    try:
        status, data = await loop.run_in_executor(
            None, lambda: brain_office.call(request.method, sub, body, params))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    return JSONResponse(data, status_code=status)


@app.get("/api/google")
async def google_snapshot(days: int = 7):
    """Google Agenda + Google Tasks pela conta conectada no Planner Core, com erro legivel (ex.:
    autorizacao expirada) em vez de lista vazia."""
    import google_bridge
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, google_bridge.snapshot, days)


@app.post("/api/google/reconnect")
async def google_reconnect():
    import google_bridge
    loop = asyncio.get_event_loop()
    return {"message": await loop.run_in_executor(None, google_bridge.open_reconnect)}


# ---- notificacoes do Brain Office (lembretes, "tarefa atrasada", avisos dos agentes) ----
_nudge_seen: dict[str, float] = {}


def _in_quiet_hours(ncfg: dict) -> bool:
    start, end = ncfg.get("quiet_start", "22:00"), ncfg.get("quiet_end", "07:00")
    now = datetime.now().strftime("%H:%M")
    return (now >= start or now < end) if start > end else (start <= now < end)


def _on_office_nudge(text: str, agent: str):
    """Chamado da thread do office_notifier."""
    if state.loop is not None and text:
        asyncio.run_coroutine_threadsafe(handle_office_nudge(text, agent), state.loop)


async def handle_office_nudge(text: str, agent: str):
    ncfg = state.config.get("notifications") or {}
    await broadcast({"type": "office_nudge", "text": text, "agent": agent, "time": ts()})
    if not ncfg.get("voice", True):
        return
    key = " ".join(text.lower().split())
    now = time.time()
    # os lembretes do escritorio se repetem a cada ciclo ("Tarefa atrasada: X" toda hora): na tela
    # aparecem sempre, na voz so a cada repeat_min
    if now - _nudge_seen.get(key, 0) < float(ncfg.get("repeat_min", 180)) * 60 or _in_quiet_hours(ncfg):
        return
    if _live_running():
        mod = _live_agent()
        if mod.is_paused():
            return  # usuario conversando com outra pessoa: nao interrompe nem marca como dito
        _nudge_seen[key] = now
        mod.announce(text)
        return
    if state.config.get("actions_enabled") and state.connected:
        _nudge_seen[key] = now
        gcfg = state.config.get("gestures", {}).get("button1_single", {}).get("params", {})
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, _speak_blocking, f"Lembrete: {text}",
                                       gcfg.get("tts_model", "pt_BR-faber-medium.onnx"))
        except Exception as e:
            print(f"[office_nudge] erro ao falar: {e}", flush=True)


@app.post("/api/office-start")
async def office_start():
    import brain_office
    loop = asyncio.get_event_loop()
    return {"message": await loop.run_in_executor(None, brain_office.start)}


@app.get("/api/gateway/health")
async def gateway_health():
    """Testa o gateway LLM configurado (9router/OmniRoute) listando os modelos expostos."""
    import requests
    gw = effective_gateway()
    if not gw.get("enabled"):
        return {"provider": "groq", "ok": True, "detail": "gateway desligado — agentes falam direto com a Groq"}
    models_url = gw["base_url"].rsplit("/chat/completions", 1)[0] + "/models"
    headers = {"Authorization": f"Bearer {gw['api_key']}"} if gw.get("api_key") else {}
    loop = asyncio.get_event_loop()
    try:
        resp = await loop.run_in_executor(None, lambda: requests.get(models_url, headers=headers, timeout=3))
        resp.raise_for_status()
        ids = [m.get("id") for m in resp.json().get("data", [])]
        return {"provider": gw["provider"], "ok": True, "models": ids[:200], "model": gw.get("model")}
    except Exception as e:
        return JSONResponse({"provider": gw["provider"], "ok": False, "error": str(e)}, status_code=502)


@app.get("/api/mcp")
async def mcp_status():
    import mcp_client
    return {"servers": mcp_client.status(state.config.get("mcp_servers", []))}


@app.post("/api/mcp/reconnect")
async def mcp_reconnect():
    """Reconecta todos os servidores MCP com a config atual (depois de editar no painel)."""
    import mcp_client
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, mcp_client.reconnect, state.config.get("mcp_servers", []))
    return {"servers": mcp_client.status(state.config.get("mcp_servers", []))}


@app.post("/api/reconnect")
async def reconnect():
    """Manual one-click reconnect (dashboard STATUS tab / botão CONECTAR). ble_manager() already
    retries forever on its own, but only after its own scan-timeout + backoff sleep — this forces
    an immediate fresh attempt instead of waiting, and is also the way to reclaim the BLE central
    slot from the phone app (which holds it exclusively, see docs/10-app-android.md §10.9): drop
    whatever client we currently hold, kill the running manager task, and start a clean one."""
    if state.client:
        try:
            await state.client.disconnect()
        except Exception:
            pass
    if state.ble_task and not state.ble_task.done():
        state.ble_task.cancel()
    state.ble_task = asyncio.create_task(ble_manager())
    await broadcast({"type": "status", "connected": False, "message": "reconectando (manual)..."})
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    state.websockets.add(ws)
    await ws.send_json({
        "type": "status",
        "connected": state.connected,
        "message": "conectado" if state.connected else "aguardando conexao...",
    })
    mod = sys.modules.get("live_agent")
    await ws.send_json({"type": "live_state", "status": mod.status() if mod else "idle", "detail": ""})
    if state.battery_percent is not None:
        threshold = state.config.get("battery_low_threshold", 20)
        await ws.send_json({"type": "battery", "percent": state.battery_percent,
                              "low": state.battery_percent <= threshold})
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        state.websockets.discard(ws)


if __name__ == "__main__":
    try:
        import tray_icon
        tray_icon.start()
    except Exception as e:
        print(f"[server] icone da bandeja nao iniciado: {e}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8731, log_level="warning")
