import io
import json
import sys
import threading
import time
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd
from piper import PiperVoice

# Bluetooth (A2DP) output has extra latency/buffering vs a local speaker: closing
# the stream right after the last sample is queued can chop off the tail of the
# audio before it actually reaches the glasses. Padding with silence plus a grace
# sleep after playback gives the BT stack time to flush completely.
TRAILING_SILENCE_SECONDS = 0.6
POST_PLAYBACK_GRACE_SECONDS = 0.8
MODELS_DIR = Path(__file__).parent / "tts_models"

# Processo agora fica vivo por toda a vida do server.py (jarvis.py fala com ele via
# stdin/stdout, uma linha JSON por comando), em vez de nascer/morrer a cada fala. O
# ganho e o custo de import do piper/onnxruntime + PiperVoice.load(): antes rodava em
# TODA fala (subprocesso novo a cada vez), agora roda 1x por modelo, na primeira vez
# que aquele modelo e usado, e fica em cache pelo resto da execucao.
_voices: dict[str, PiperVoice] = {}
_stop_event = threading.Event()


def _get_voice(model_name: str) -> PiperVoice:
    voice = _voices.get(model_name)
    if voice is None:
        voice = PiperVoice.load(str(MODELS_DIR / model_name))
        _voices[model_name] = voice
    return voice


def _synthesize(text: str, model_name: str):
    voice = _get_voice(model_name)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text, wf)
    buf.seek(0)
    with wave.open(buf, "rb") as wf:
        samplerate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    audio = np.frombuffer(frames, dtype=np.int16)
    padding = np.zeros(int(samplerate * TRAILING_SILENCE_SECONDS), dtype=np.int16)
    return np.concatenate([audio, padding]), samplerate


def _speak(text: str, model_name: str):
    """Roda numa thread separada da que le stdin, de proposito: assim um comando
    "stop" que chegue enquanto isso toca e lido e processado na hora (sd.stop()
    interrompe playback em andamento), em vez de esperar esta fala terminar."""
    _stop_event.clear()
    try:
        audio, samplerate = _synthesize(text, model_name)
        if _stop_event.is_set():
            print("STOPPED", flush=True)
            return
        sd.play(audio, samplerate=samplerate)
        sd.wait()
        if _stop_event.is_set():
            print("STOPPED", flush=True)
            return
        time.sleep(POST_PLAYBACK_GRACE_SECONDS)
        print("DONE", flush=True)
    except Exception as e:
        print(f"ERROR {e}", flush=True)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = cmd.get("cmd")
        if kind == "stop":
            _stop_event.set()
            sd.stop()
        elif kind == "speak":
            threading.Thread(
                target=_speak, args=(cmd.get("text", ""), cmd.get("model", "")), daemon=True,
            ).start()


if __name__ == "__main__":
    main()
