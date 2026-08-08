"""Cadastra sua voz pro Wy Glass reconhecer QUEM esta falando — depois disso, a wake word
("Hey Jarvis") so dispara pra sua voz especificamente, ignorando TV, outras pessoas, etc.
O clique fisico do botao continua funcionando pra qualquer um, sem essa checagem (pressionar o
botao ja e, por si so, uma acao intencional).

O que isso faz: grava algumas frases suas, calcula um "embedding" de voz (resemblyzer) e salva
em voice_profile.npy, 100% local — nada sai da sua maquina. Rode isso com o server.py FECHADO
(ele tambem usa o microfone Bluetooth; os dois disputando o mesmo device da problema) ou pelo
menos com certeza de que voce e a unica pessoa falando durante o cadastro.

Uso:
    python enroll_voice.py
"""
import sys
import types
from pathlib import Path

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
PROFILE_PATH = Path(__file__).parent / "voice_profile.npy"
TARGET_DBFS = -30
RECORD_SECONDS = 3.0

PHRASES = [
    "Hey Jarvis, que horas sao agora",
    "Hey Jarvis, inicia a traducao",
    "Hey Jarvis, qual e a previsao do tempo",
    "Hey Jarvis, abre o dashboard pra mim",
    "Hey Jarvis, obrigado pela ajuda",
]


def _stub_webrtcvad():
    # mesmo motivo documentado em speaker_verify_worker.py: webrtcvad tem extensao C que nao
    # compila neste ambiente (Python 3.14, sem Visual Studio) — nao precisamos dele de verdade,
    # so da funcao de embedding do resemblyzer, que nao depende de VAD nenhum.
    if "webrtcvad" in sys.modules:
        return
    stub = types.ModuleType("webrtcvad")

    class _UnusedVad:
        def __init__(self, *a, **kw):
            raise RuntimeError("webrtcvad e um stub aqui — nao deveria ser chamado")
    stub.Vad = _UnusedVad
    sys.modules["webrtcvad"] = stub


def record(seconds: float = RECORD_SECONDS) -> np.ndarray:
    audio = sd.rec(int(seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    return audio.flatten()


def main():
    _stub_webrtcvad()
    from resemblyzer import VoiceEncoder
    from resemblyzer.audio import normalize_volume

    print("=== Cadastro de voz — Wy Glass ===\n")
    print(f"Vou pedir pra voce falar {len(PHRASES)} frases curtas, ~{RECORD_SECONDS:.0f}s cada.")
    print("Fale num tom normal, como voce falaria de verdade com os oculos no dia a dia.\n")

    encoder = VoiceEncoder()
    embeddings = []
    for i, phrase in enumerate(PHRASES, 1):
        input(f"[{i}/{len(PHRASES)}] Pressione ENTER e fale: \"{phrase}\"")
        print("gravando...")
        wav = record()
        wav = normalize_volume(wav, TARGET_DBFS, increase_only=True)
        embeddings.append(encoder.embed_utterance(wav))
        print("[OK] capturado\n")

    profile = np.mean(embeddings, axis=0)
    profile = profile / np.linalg.norm(profile)
    np.save(PROFILE_PATH, profile)

    print(f"Perfil de voz salvo em {PROFILE_PATH}")
    print("Reinicie o servidor (python start_all.py) pra ativar a verificacao na wake word.")
    print("Pra recadastrar do zero, so rode este script de novo — ele sobrescreve o perfil antigo.")


if __name__ == "__main__":
    main()
