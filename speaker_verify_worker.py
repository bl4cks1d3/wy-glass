"""Reconhecimento de locutor (biometria de voz) em processo separado — mesmo motivo do
tts_worker.py e do wakeword_worker.py: bibliotecas nativas pesadas (aqui, torch por baixo do
resemblyzer) tem historico de conflito de DLL com bleak/WinRT quando carregadas no mesmo
processo (ver docs/04-arquitetura.md §4.8). Isolar em subprocesso evita o problema de saida.

Ambiente peculiar (Python 3.14, muito recente): o resemblyzer declara `webrtcvad` como
dependencia, mas esse pacote tem extensao C que nao compila aqui (falta Visual Studio, e nao
existe wheel pre-compilada pra Python 3.14 ainda). A solucao e um stub: so usamos
`wav_to_mel_spectrogram` + `VoiceEncoder.embed_utterance` do resemblyzer, nunca a funcao
`trim_long_silences` (a unica que de fato *chama* webrtcvad.Vad em runtime) — o VAD real de
verdade ja e feito por `jarvis.record_audio_vad` antes do audio chegar aqui. Por isso um stub
vazio (nunca instanciado de verdade) e seguro: satisfaz o `import webrtcvad` sem nunca ser
exercitado.

Protocolo: uma linha JSON por comando via stdin, uma linha JSON de resposta via stdout.
    {"cmd": "enroll", "wavs_b64": [<wav b64>, ...]} -> {"status": "ok"/"error", ...}
    {"cmd": "verify", "wav_b64": <wav b64>, "threshold": 0.75}
        -> {"has_profile": bool, "matched": bool, "similarity": float|null}

Uso: python speaker_verify_worker.py
"""
import base64
import io
import json
import sys
import types
import wave
from pathlib import Path

import numpy as np

PROFILE_PATH = Path(__file__).parent / "voice_profile.npy"
TARGET_DBFS = -30
DEFAULT_THRESHOLD = 0.75


def _stub_webrtcvad():
    if "webrtcvad" in sys.modules:
        return
    stub = types.ModuleType("webrtcvad")

    class _UnusedVad:
        def __init__(self, *a, **kw):
            raise RuntimeError("webrtcvad e um stub neste projeto — trim_long_silences() nunca "
                                "deveria ser chamada (usamos jarvis.record_audio_vad pro VAD real)")
    stub.Vad = _UnusedVad
    sys.modules["webrtcvad"] = stub


_stub_webrtcvad()
from resemblyzer import VoiceEncoder  # noqa: E402 (precisa vir depois do stub acima)
from resemblyzer.audio import normalize_volume  # noqa: E402

_encoder = VoiceEncoder(verbose=False)  # verbose=True (default) imprime no stdout, quebrando o
                                         # protocolo de 1 linha JSON por resposta deste worker


def _wav_bytes_to_float(wav_bytes: bytes) -> np.ndarray:
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as wf:
        sr = wf.getframerate()
        frames = wf.readframes(wf.getnframes())
    pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if sr != 16000:
        import librosa
        pcm = librosa.resample(pcm, orig_sr=sr, target_sr=16000)
    return pcm


def _embed(wav_float: np.ndarray) -> np.ndarray:
    wav_float = normalize_volume(wav_float, TARGET_DBFS, increase_only=True)
    emb = _encoder.embed_utterance(wav_float)
    return emb / np.linalg.norm(emb)


def handle_enroll(payload: dict) -> dict:
    embeddings = []
    for b64 in payload.get("wavs_b64", []):
        wav = _wav_bytes_to_float(base64.b64decode(b64))
        embeddings.append(_embed(wav))
    if not embeddings:
        return {"status": "error", "message": "nenhuma amostra recebida"}
    profile = np.mean(embeddings, axis=0)
    profile = profile / np.linalg.norm(profile)
    np.save(PROFILE_PATH, profile)
    return {"status": "ok", "profile_path": str(PROFILE_PATH), "samples": len(embeddings)}


def handle_verify(payload: dict) -> dict:
    if not PROFILE_PATH.exists():
        # sem perfil cadastrado ainda -> "fail open": nao bloqueia ninguem por padrao, so quem
        # rodar enroll_voice.py de proposito ativa a checagem de verdade.
        return {"has_profile": False, "matched": True, "similarity": None}
    profile = np.load(PROFILE_PATH)
    wav = _wav_bytes_to_float(base64.b64decode(payload["wav_b64"]))
    emb = _embed(wav)
    similarity = float(np.dot(profile, emb))
    threshold = float(payload.get("threshold", DEFAULT_THRESHOLD))
    return {"has_profile": True, "matched": similarity >= threshold, "similarity": similarity}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        cmd = payload.get("cmd")
        try:
            if cmd == "enroll":
                result = handle_enroll(payload)
            elif cmd == "verify":
                result = handle_verify(payload)
            else:
                result = {"status": "error", "message": f"comando desconhecido: {cmd}"}
        except Exception as e:
            result = {"status": "error", "message": str(e)}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
