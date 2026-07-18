import subprocess
import webbrowser
import wave
from datetime import datetime
from pathlib import Path


def run_command(params: dict):
    command = params.get("command", "")
    args = params.get("args", [])
    if not command:
        raise ValueError("command vazio")
    subprocess.Popen([command, *args], shell=False)
    return f"executado: {command}"


def open_url(params: dict):
    url = params.get("url", "")
    if not url:
        raise ValueError("url vazia")
    webbrowser.open(url)
    return f"aberto: {url}"


def key_shortcut(params: dict):
    import keyboard
    keys = params.get("keys", "")
    if not keys:
        raise ValueError("keys vazio")
    keyboard.send(keys)
    return f"atalho enviado: {keys}"


def screenshot(params: dict):
    from PIL import ImageGrab
    folder = Path(params.get("folder", "./screenshots"))
    folder.mkdir(parents=True, exist_ok=True)
    filename = folder / f"screenshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    img = ImageGrab.grab()
    img.save(filename)
    return f"screenshot salvo: {filename}"


def voice_command(params: dict):
    import sounddevice as sd
    duration = float(params.get("duration_seconds", 4))
    samplerate = 16000
    folder = Path(params.get("folder", "./recordings"))
    folder.mkdir(parents=True, exist_ok=True)
    filename = folder / f"voice_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"

    recording = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="int16")
    sd.wait()

    with wave.open(str(filename), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(samplerate)
        wf.writeframes(recording.tobytes())

    return f"audio gravado ({duration}s): {filename}"


def jarvis_voice_agent(params: dict):
    import jarvis
    return jarvis.run_jarvis(params)


ACTIONS = {
    "run_command": run_command,
    "open_url": open_url,
    "key_shortcut": key_shortcut,
    "screenshot": screenshot,
    "voice_command": voice_command,
    "jarvis_voice_agent": jarvis_voice_agent,
}


def run_action(action_type: str, params: dict) -> str:
    fn = ACTIONS.get(action_type)
    if fn is None:
        raise ValueError(f"tipo de acao desconhecido: {action_type}")
    return fn(params)
