import os
import threading
import time
import wave
import io
import requests
import numpy as np
import sounddevice as sd
from pathlib import Path

SAMPLE_RATE = 16000
TTS_MODELS_DIR = Path(__file__).parent / "tts_models"


PROVIDER_CHAT_URLS = {
    "groq": "https://api.groq.com/openai/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "mistral": "https://api.mistral.ai/v1/chat/completions",
}

PROVIDER_DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash",
    "groq": "llama-3.3-70b-versatile",
    "openrouter": "meta-llama/llama-3.3-70b-instruct:free",
    "mistral": "mistral-small-latest",
    "ollama": "llama3.2",
}

GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"


def get_api_key(params: dict) -> str:
    key = params.get("google_api_key") or params.get("api_key") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise ValueError("nenhuma chave de API configurada para o Gemini (defina GOOGLE_API_KEY ou o campo no painel)")
    return key


def play_beep(frequency: float = 880.0, duration: float = 0.12, volume: float = 0.25):
    """Beep curto e sintetico (seno puro, sem Piper/onnxruntime — muito mais rapido que TTS)
    tocado como confirmacao audivel de "comecei a escutar", toda vez que record_audio_vad() vai
    abrir o microfone. Fade in/out de 10ms evita o estalo (click) que um tom cortado sem
    transicao produziria no inicio/fim."""
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    tone = (np.sin(2 * np.pi * frequency * t) * volume).astype(np.float32)
    fade_len = min(len(tone) // 2, max(1, int(SAMPLE_RATE * 0.01)))
    fade = np.linspace(0, 1, fade_len, dtype=np.float32)
    tone[:fade_len] *= fade
    tone[-fade_len:] *= fade[::-1]
    sd.play(tone, samplerate=SAMPLE_RATE)
    sd.wait()


def record_audio(duration_seconds: float) -> bytes:
    recording = sd.rec(int(duration_seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="int16")
    sd.wait()
    return recording.tobytes()


def get_capture_manager():
    """Returns the shared AudioCaptureManager if audio_capture is importable, else None
    (falls back to opening a dedicated device stream — e.g. when running standalone
    scripts that don't go through server.py)."""
    try:
        import audio_capture
        return audio_capture.get_capture_manager()
    except ImportError:
        return None


def record_audio_vad(
    max_duration: float = 15.0,
    silence_duration: float = 1.0,
    silence_threshold: float = 300.0,
    min_speech_duration: float = 0.3,
    chunk_ms: float = 30.0,
    capture_manager=None,
) -> bytes:
    """Records until `silence_duration` seconds of quiet follow at least
    `min_speech_duration` seconds of detected speech, or `max_duration` is hit.

    If `capture_manager` is given, reads blocks from its shared queue instead of
    opening a dedicated sd.InputStream — required once other listeners (wake word,
    clap detection) hold the mic's single exclusive capture stream open."""
    try:
        play_beep()
    except Exception:
        pass  # beep e so uma confirmacao sonora — nunca deve impedir a gravacao de verdade
    chunk_size = max(1, int(SAMPLE_RATE * chunk_ms / 1000))
    silence_chunks_needed = max(1, int(silence_duration * 1000 / chunk_ms))
    max_chunks = max(1, int(max_duration * 1000 / chunk_ms))
    speech_chunks_needed = max(1, int(min_speech_duration * 1000 / chunk_ms))

    frames = []
    speech_chunks = 0
    silence_chunks = 0

    def process(chunk) -> bool:
        """Appends chunk and returns True once recording should stop."""
        nonlocal speech_chunks, silence_chunks
        frames.append(chunk.copy())
        rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))
        if rms > silence_threshold:
            speech_chunks += 1
            silence_chunks = 0
        elif speech_chunks >= speech_chunks_needed:
            silence_chunks += 1
            if silence_chunks >= silence_chunks_needed:
                return True
        return False

    if capture_manager is not None:
        q = capture_manager.subscribe()
        try:
            for _ in range(max_chunks):
                chunk = q.get(timeout=5.0)
                if process(chunk):
                    break
        finally:
            capture_manager.unsubscribe(q)
    else:
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=chunk_size) as stream:
            for _ in range(max_chunks):
                chunk, _ = stream.read(chunk_size)
                if process(chunk):
                    break

    try:
        play_beep(frequency=500.0)  # tom mais grave que o de inicio (880Hz) — "parei de escutar"
    except Exception:
        pass

    audio = np.concatenate(frames, axis=0) if frames else np.zeros((0, 1), dtype="int16")
    return audio.tobytes()


def pcm_to_wav_bytes(pcm: bytes, samplerate: int) -> bytes:
    import io
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(samplerate)
        wf.writeframes(pcm)
    return buf.getvalue()


def ask_gemini(api_key: str, wav_bytes: bytes, model: str, system_prompt: str, max_retries: int = 3) -> str:
    import base64
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": "audio/wav", "data": audio_b64}},
                {"text": "Responda a pergunta ou pedido acima falado pelo usuario."},
            ]
        }],
    }

    last_error = None
    for attempt in range(max_retries):
        resp = requests.post(url, json=payload, timeout=60)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            wait_s = float(retry_after) if retry_after else (2 ** attempt) * 3
            last_error = f"429 rate limit (tentativa {attempt + 1}/{max_retries}, esperando {wait_s:.0f}s)"
            time.sleep(wait_s)
            continue
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"].strip()

    raise RuntimeError(f"Gemini continuou com rate limit apos {max_retries} tentativas ({last_error})")


def ask_groq_whisper(api_key: str, wav_bytes: bytes) -> str:
    """STT step for every non-Gemini provider — Gemini accepts audio directly, everyone else
    (Groq, OpenRouter, Mistral, Ollama) only accepts text, so audio is transcribed first via
    Groq's free Whisper endpoint (Whisper itself is open-source; Groq just serves it fast)."""
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
    data = {"model": "whisper-large-v3", "language": "pt"}
    resp = requests.post(GROQ_WHISPER_URL, headers=headers, files=files, data=data, timeout=60)
    resp.raise_for_status()
    return resp.json().get("text", "").strip()


def ask_chat_provider(base_url: str, api_key: str, model: str, system_prompt: str, user_text: str, max_retries: int = 3) -> str:
    """Groq, OpenRouter, Mistral and Ollama all speak the same OpenAI-style chat/completions
    shape, so one function covers all four — only base_url, api_key and model differ."""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "temperature": 0.7,
    }

    last_error = None
    for attempt in range(max_retries):
        resp = requests.post(base_url, json=payload, headers=headers, timeout=60)
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            wait_s = float(retry_after) if retry_after else (2 ** attempt) * 3
            last_error = f"429 rate limit (tentativa {attempt + 1}/{max_retries}, esperando {wait_s:.0f}s)"
            time.sleep(wait_s)
            continue
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"].strip()

    raise RuntimeError(f"provedor continuou com rate limit apos {max_retries} tentativas ({last_error})")


def _passive_listener_pause():
    try:
        import passive_listener
        passive_listener.pause()
    except ImportError:
        pass


def _passive_listener_resume():
    try:
        import passive_listener
        passive_listener.resume()
    except ImportError:
        pass


_current_tts_process = None
_tts_interrupted = False
_current_tts_lock = threading.Lock()


def speak(text: str, model_name: str):
    import subprocess
    import sys
    global _current_tts_process, _tts_interrupted
    worker = Path(__file__).parent / "tts_worker.py"
    # Pause wake-word/clap listening while the TTS plays out of the same Bluetooth
    # speaker the mic listens on — otherwise the assistant's own voice can retrigger it.
    _passive_listener_pause()
    # Popen (nao subprocess.run) de proposito: precisa do handle do processo pra poder matar
    # (stop_speaking()) enquanto ainda esta tocando — clique no botao durante a reproducao corta
    # a fala na hora, em vez de esperar terminar a frase inteira.
    proc = subprocess.Popen(
        [sys.executable, str(worker), text, model_name],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    with _current_tts_lock:
        _current_tts_process = proc
        _tts_interrupted = False
    try:
        try:
            _, stderr = proc.communicate(timeout=60)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, stderr = proc.communicate()
    finally:
        with _current_tts_lock:
            was_interrupted = _tts_interrupted
            if _current_tts_process is proc:
                _current_tts_process = None
        _passive_listener_resume()
    # No Windows, Popen.kill() (TerminateProcess) normalmente devolve um returncode POSITIVO
    # (nao negativo feito um sinal POSIX) — dai a flag explicita em vez de inspecionar o
    # returncode: interrupcao de proposito via stop_speaking() nao e uma falha real do
    # tts_worker, nao deve virar excecao/erro de turno.
    if proc.returncode != 0 and not was_interrupted:
        raise RuntimeError((stderr or "").strip()[-500:] or "tts_worker falhou sem mensagem")


def stop_speaking():
    """Corta a fala em andamento, se houver — chamado quando o usuario aperta o botao 2 durante
    a reproducao. Idempotente: nao faz nada se nao tiver nenhum tts_worker rodando no momento."""
    global _tts_interrupted
    with _current_tts_lock:
        proc = _current_tts_process
        if proc is None or proc.poll() is not None:
            return
        _tts_interrupted = True
    proc.kill()


def run_jarvis(params: dict) -> str:
    provider = params.get("provider", "gemini")
    model = params.get("model") or PROVIDER_DEFAULT_MODELS.get(provider, "")
    system_prompt = params.get("system_prompt", "Voce e um assistente de voz util, direto e simpatico. Responda sempre em portugues do Brasil, de forma breve (1-3 frases).")
    tts_model = params.get("tts_model", "pt_BR-faber-medium.onnx")

    t0 = time.time()
    pcm = record_audio_vad(
        max_duration=float(params.get("max_duration_seconds", 15)),
        silence_duration=float(params.get("silence_duration_seconds", 1.0)),
        silence_threshold=float(params.get("silence_threshold", 300)),
        capture_manager=get_capture_manager(),
    )
    wav_bytes = pcm_to_wav_bytes(pcm, SAMPLE_RATE)

    if provider == "gemini":
        api_key = get_api_key(params)
        reply_text = ask_gemini(api_key, wav_bytes, model, system_prompt)
    else:
        stt_key = params.get("stt_api_key") or (params.get("api_key") if provider == "groq" else None)
        if not stt_key:
            raise ValueError(
                "provedores nao-Gemini precisam de uma chave Groq (campo 'stt_api_key') para "
                "transcrever o audio localmente antes de perguntar ao modelo escolhido"
            )
        user_text = ask_groq_whisper(stt_key, wav_bytes)
        if not user_text:
            raise RuntimeError("nao entendi o que voce disse")

        if provider == "ollama":
            host = params.get("ollama_host", "127.0.0.1").strip().rstrip("/") or "127.0.0.1"
            base_url = f"http://{host}:11434/v1/chat/completions"
            api_key = ""
        elif provider in PROVIDER_CHAT_URLS:
            base_url = PROVIDER_CHAT_URLS[provider]
            api_key = params.get("api_key", "")
            if not api_key:
                raise ValueError(f"nenhuma chave de API configurada para o provedor '{provider}'")
        else:
            raise ValueError(f"provedor de IA desconhecido: {provider}")

        reply_text = ask_chat_provider(base_url, api_key, model, system_prompt, user_text)

    try:
        speak(reply_text, tts_model)
    except Exception as e:
        elapsed = time.time() - t0
        return f"jarvis (sem audio, TTS falhou: {e}): \"{reply_text}\" ({elapsed:.1f}s)"

    elapsed = time.time() - t0
    return f"jarvis: \"{reply_text}\" ({elapsed:.1f}s)"
