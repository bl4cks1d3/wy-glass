"""Cadastra sua voz pro Wy Glass reconhecer QUEM esta falando — depois disso, a wake word
("Hey Jarvis") so dispara pra sua voz especificamente, ignorando TV, outras pessoas, etc.
O clique fisico do botao continua funcionando pra qualquer um, sem essa checagem (pressionar o
botao ja e, por si so, uma acao intencional).

O que isso faz: grava algumas frases suas e manda pro speaker_verify_worker.py (subprocesso
separado) calcular o embedding de voz (resemblyzer) e salvar em voice_profile.npy, 100% local —
nada sai da sua maquina. Rode isso com o server.py FECHADO (ele tambem usa o microfone
Bluetooth; os dois disputando o mesmo device da problema) ou pelo menos com certeza de que voce
e a unica pessoa falando durante o cadastro.

Por que nao calcular o embedding aqui mesmo, no processo principal (como a primeira versao
deste script fazia)? Erro real encontrado em uso: gravar com `sounddevice` E carregar
`resemblyzer`/`torch` no MESMO processo derruba com "[WinError 1114] ... Error loading
c10.dll" — mesma classe de conflito de DLL nativa ja documentada pro Piper/onnxruntime (ver
docs/04-arquitetura.md §4.8) e pro openWakeWord/onnxruntime (ver docs/07-roteiro-futuro.md
§7.1), so que dessa vez entre sounddevice/PortAudio e torch. A correcao segue o mesmo padrao
do resto do projeto: isolar a lib nativa pesada (aqui, torch via resemblyzer) num subprocesso
separado — a gravacao continua aqui (sounddevice de verdade so precisa rodar uma vez, nao
justifica seu proprio subprocesso), so o calculo do embedding e delegado.

Uso:
    python enroll_voice.py
"""
import base64
import io
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
RECORD_SECONDS = 3.0
WORKER_PATH = Path(__file__).parent / "speaker_verify_worker.py"

PHRASES = [
    "Hey Jarvis, que horas sao agora",
    "Hey Jarvis, inicia a traducao",
    "Hey Jarvis, qual e a previsao do tempo",
    "Hey Jarvis, abre o dashboard pra mim",
    "Hey Jarvis, obrigado pela ajuda",
]


def record_wav_b64(seconds: float = RECORD_SECONDS) -> str:
    audio = sd.rec(int(seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="int16")
    sd.wait()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(audio.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


def main():
    print("=== Cadastro de voz — Wy Glass ===\n")
    print(f"Vou pedir pra voce falar {len(PHRASES)} frases curtas, ~{RECORD_SECONDS:.0f}s cada.")
    print("Fale num tom normal, como voce falaria de verdade com os oculos no dia a dia.\n")

    wavs_b64 = []
    for i, phrase in enumerate(PHRASES, 1):
        input(f"[{i}/{len(PHRASES)}] Pressione ENTER e fale: \"{phrase}\"")
        print("gravando...")
        wavs_b64.append(record_wav_b64())
        print("[OK] capturado\n")

    print("Calculando o perfil de voz (subprocesso separado, primeira vez demora ~10-15s)...")
    proc = subprocess.Popen(
        [sys.executable, str(WORKER_PATH)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    proc.stdin.write(json.dumps({"cmd": "enroll", "wavs_b64": wavs_b64}) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline().strip()
    proc.kill()

    if not line:
        stderr = proc.stderr.read()
        print("Deu erro no worker de reconhecimento de voz, sem resposta.")
        if stderr.strip():
            print(f"Detalhe: {stderr.strip()[-800:]}")
        sys.exit(1)

    result = json.loads(line)
    if result.get("status") != "ok":
        print(f"Deu erro: {result.get('message', line)}")
        sys.exit(1)

    print(f"\nPerfil de voz salvo em {result['profile_path']} ({result['samples']} amostras)")
    print("Reinicie o servidor (python start_all.py) pra ativar a verificacao na wake word.")
    print("Pra recadastrar do zero, so rode este script de novo — ele sobrescreve o perfil antigo.")


if __name__ == "__main__":
    main()
