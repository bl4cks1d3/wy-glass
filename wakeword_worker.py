"""Roda o openWakeWord em processo separado — necessario pelo mesmo motivo documentado em
docs/04-arquitetura.md §4.8 pro Piper TTS: onnxruntime (usado por baixo do openWakeWord) entra
em conflito de DLL nativa com bleak/WinRT quando os dois estao carregados no MESMO processo
(nao e um problema de thread — importar dentro de uma thread dedicada, como foi tentado
primeiro em passive_listener.py, NAO evita o conflito, porque o carregamento de DLL do Windows
e por processo, nao por thread). O sintoma real foi a thread inteira do passive_listener
morrendo sem aviso na primeira deteccao apos a wakeword ser ativada.

Protocolo: le PCM int16 mono 16kHz cru do stdin em blocos fixos (BYTES_PER_CHUNK), devolve uma
linha "TRIGGER" no stdout toda vez que a wakeword dispara (deteccao por borda de subida — nao
dispara de novo enquanto o score continuar acima do threshold).

Uso: python wakeword_worker.py <model_name> <threshold>
"""
import sys

import numpy as np

CHUNK_SAMPLES = 480  # 30ms a 16kHz mono — precisa bater com passive_listener.CHUNK_MS/audio_capture.py
BYTES_PER_CHUNK = CHUNK_SAMPLES * 2  # int16 = 2 bytes/amostra


def main():
    model_name = sys.argv[1] if len(sys.argv) > 1 else "hey_jarvis"
    threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5

    from openwakeword.model import Model
    model = Model(wakeword_models=[model_name], inference_framework="onnx")

    stdin = sys.stdin.buffer
    armed = True
    while True:
        raw = stdin.read(BYTES_PER_CHUNK)
        if len(raw) < BYTES_PER_CHUNK:
            break  # pipe fechado (processo pai encerrou) ou EOF
        chunk = np.frombuffer(raw, dtype=np.int16)
        scores = model.predict(chunk)
        score = float(scores.get(model_name, 0.0))
        if score >= threshold:
            if armed:
                armed = False
                print("TRIGGER", flush=True)
        else:
            armed = True


if __name__ == "__main__":
    main()
