import asyncio
import json
import time
import traceback
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
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


async def run_action_async(action_type: str, params: dict) -> str:
    # Credentials (Groq/Tavily/Gemini keys) are glasses-wide capabilities, not
    # tied to any one gesture — merged in here so every action sees them
    # without each gesture having to repeat the same key in its own params.
    # A gesture's own params still win on collision (explicit override).
    merged = {**state.config.get("credentials", {}), **params}
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
    jarvis.speak(greeting, tts_model)
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
        user_name = gcfg.get("user_name", "sankofa")
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

                await client.start_notify(state.config["notify_char_uuid"], notification_handler(loop))
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
            if percent is None:
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
    state.ble_task = asyncio.create_task(ble_manager())
    asyncio.create_task(groq_model_healthcheck())
    asyncio.create_task(battery_monitor())


@app.on_event("shutdown")
async def shutdown():
    _passive_listener().stop()
    _audio_capture().get_capture_manager().stop()
    try:
        import browser_tools
        browser_tools.close()
    except ImportError:
        pass


@app.get("/", response_class=HTMLResponse)
async def landing():
    return FileResponse(BASE_DIR / "static" / "landing.html")


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
