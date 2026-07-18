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
        self.counters = {"button1": ButtonCounter("button1"), "button2": ButtonCounter("button2")}
        self.conversation_active = False
        self.conversation_task = None


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


async def stop_conversation(gesture_key: str, raw_hex: str):
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
            import jarvis
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, jarvis.speak, farewell, tts_model)
        except Exception as e:
            await broadcast({"type": "action_result", "gesture": gesture_key, "ok": False, "message": str(e), "time": ts()})


async def conversation_loop(gesture_key: str, gcfg: dict):
    state.conversation_active = True
    await broadcast({"type": "conversation", "status": "started"})
    _passive_listener().pause()  # don't let wake word / clap detection compete for the mic
    try:
        while state.conversation_active:
            try:
                result = await run_action_async(gcfg["action"], gcfg.get("params", {}))
                await broadcast({"type": "action_result", "gesture": gesture_key, "ok": True, "message": result, "time": ts()})
            except Exception as e:
                await broadcast({"type": "action_result", "gesture": gesture_key, "ok": False, "message": str(e), "time": ts()})
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


@app.on_event("startup")
async def startup():
    asyncio.create_task(ble_manager())


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
             "actions_enabled": state.config.get("actions_enabled", False)}


@app.post("/api/test/{gesture_key}")
async def test_gesture(gesture_key: str):
    await fire_gesture(gesture_key, raw_hex="(teste manual)")
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
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        state.websockets.discard(ws)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8731, log_level="warning")
