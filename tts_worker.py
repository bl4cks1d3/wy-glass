import io
import sys
import time
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

# Bluetooth (A2DP) output has extra latency/buffering vs a local speaker: closing
# the stream right after the last sample is queued can chop off the tail of the
# audio before it actually reaches the glasses. Padding with silence plus a grace
# sleep after playback gives the BT stack time to flush completely.
TRAILING_SILENCE_SECONDS = 0.6
POST_PLAYBACK_GRACE_SECONDS = 0.8


def main():
    text = sys.argv[1]
    model_name = sys.argv[2]

    from piper import PiperVoice
    model_path = Path(__file__).parent / "tts_models" / model_name
    voice = PiperVoice.load(str(model_path))

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        voice.synthesize_wav(text, wf)
    buf.seek(0)
    with wave.open(buf, "rb") as wf:
        samplerate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    audio = np.frombuffer(frames, dtype=np.int16)
    padding = np.zeros(int(samplerate * TRAILING_SILENCE_SECONDS), dtype=np.int16)
    audio = np.concatenate([audio, padding])

    sd.play(audio, samplerate=samplerate)
    sd.wait()
    time.sleep(POST_PLAYBACK_GRACE_SECONDS)


if __name__ == "__main__":
    main()
