import atexit
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


def play_beep(frequency: float = 880.0, duration: float = 0.18, volume: float = 0.5, count: int = 1):
    """Beep curto e sintetico (seno puro, sem Piper/onnxruntime — muito mais rapido que TTS)
    tocado como confirmacao audivel de "comecei a escutar", toda vez que record_audio_vad() vai
    abrir o microfone. Fade in/out de 10ms evita o estalo (click) que um tom cortado sem
    transicao produziria no inicio/fim. `count` repete o beep (com um respiro entre eles) — usado
    pra "comecei a escutar" (2x) soar claramente diferente de "parei de escutar" (1x), depois de
    volume/duracao terem se mostrado curtos/baixos demais pra notar em uso real."""
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    tone = (np.sin(2 * np.pi * frequency * t) * volume).astype(np.float32)
    fade_len = min(len(tone) // 2, max(1, int(SAMPLE_RATE * 0.01)))
    fade = np.linspace(0, 1, fade_len, dtype=np.float32)
    tone[:fade_len] *= fade
    tone[-fade_len:] *= fade[::-1]
    gap = np.zeros(int(SAMPLE_RATE * 0.08), dtype=np.float32)
    sequence = tone
    for _ in range(count - 1):
        sequence = np.concatenate([sequence, gap, tone])
    sd.play(sequence, samplerate=SAMPLE_RATE)
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
        play_beep(count=2)  # 2 bips = "pode falar", distinto do bip unico de "parei de escutar"
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


def reduce_noise_pcm(pcm: bytes, samplerate: int) -> bytes:
    """Aplica supressao de ruido (spectral gating, `noisereduce`) na gravacao ja feita — roda
    DEPOIS do VAD (record_audio_vad ja decidiu onde a fala comeca/termina), no clipe final,
    nunca no stream continuo em tempo real da wake word (o algoritmo estima o perfil de ruido a
    partir de uma janela de contexto, nao e desenhado pra rodar em chunks de 30ms isolados —
    ficaria inconsistente). Melhora a transcricao do Whisper e a verificacao de locutor (os dois
    usam o mesmo wav_bytes gerado a partir daqui). ~0.1-0.2s pra um clipe de alguns segundos —
    negligivel frente ao resto do pipeline (STT + LLM + TTS)."""
    import noisereduce as nr
    audio_f32 = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if len(audio_f32) < samplerate // 4:
        return pcm  # clipe curto demais (menos de ~0.25s) — sem contexto suficiente, so devolve como veio
    reduced = nr.reduce_noise(y=audio_f32, sr=samplerate)
    reduced_i16 = np.clip(reduced * 32768.0, -32768, 32767).astype(np.int16)
    return reduced_i16.tobytes()


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


def ask_groq_whisper(api_key: str, wav_bytes: bytes, language: str | None = "pt",
                      detect_language: bool = False):
    """STT step for every non-Gemini provider — Gemini accepts audio directly, everyone else
    (Groq, OpenRouter, Mistral, Ollama) only accepts text, so audio is transcribed first via
    Groq's free Whisper endpoint (Whisper itself is open-source; Groq just serves it fast).

    `language=None` deixa o Whisper detectar o idioma sozinho em vez de forcar portugues —
    usado pelo translator_agent (actions.py), que precisa transcrever fala em qualquer idioma.

    `detect_language=True` pede `response_format=verbose_json` (endpoint OpenAI-compativel) e
    retorna um dict {"text", "language"} em vez de so a string — o translator_agent usa o idioma
    detectado pra decidir a direcao da traducao (fala em pt -> traduz pra ingles, e vice-versa).
    Mantido como parametro extra (default False, retorno str) pra nao quebrar quem ja chama isso
    so pelo texto."""
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
    data = {"model": "whisper-large-v3"}
    if language:
        data["language"] = language
    if detect_language:
        data["response_format"] = "verbose_json"
    resp = requests.post(GROQ_WHISPER_URL, headers=headers, files=files, data=data, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    if detect_language:
        return {"text": (payload.get("text") or "").strip(), "language": payload.get("language") or ""}
    return (payload.get("text") or "").strip()


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


_tts_worker_process = None
_tts_worker_lock = threading.Lock()  # protege criacao/reinicio do processo E escritas no stdin dele
                                      # (speak() e stop_speaking() rodam em threads diferentes e podem
                                      # escrever ao mesmo tempo — sem lock, duas escritas concorrentes
                                      # podem intercalar bytes e corromper a linha JSON)


def _spawn_tts_worker():
    import subprocess
    import sys
    worker = Path(__file__).parent / "tts_worker.py"
    proc = subprocess.Popen(
        [sys.executable, str(worker)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1,  # line-buffered dos dois lados — protocolo e uma linha JSON por comando/resposta
    )
    threading.Thread(target=_drain_stderr, args=(proc,), daemon=True).start()
    return proc


def _drain_stderr(proc):
    """Sem isso o pipe de stderr do worker enche (nunca e lido) e trava a proxima escrita dele —
    so precisamos ler pra nao bloquear; erros reais vem como linha "ERROR ..." no stdout."""
    try:
        for line in proc.stderr:
            if line.strip():
                print(f"[tts_worker] {line.rstrip()}", flush=True)
    except Exception:
        pass


def _get_tts_worker():
    global _tts_worker_process
    with _tts_worker_lock:
        if _tts_worker_process is None or _tts_worker_process.poll() is not None:
            _tts_worker_process = _spawn_tts_worker()
        return _tts_worker_process


@atexit.register
def _kill_tts_worker():
    """Sem isso o tts_worker persistente (§ speak()) vira processo orfao quando o server.py
    fecha — antes cada fala nascia e morria sozinha (Popen por chamada), entao nao havia nada
    pra limpar no encerramento."""
    proc = _tts_worker_process
    if proc is not None and proc.poll() is None:
        proc.kill()


def speak(text: str, model_name: str):
    """Fala texto em voz alta via o tts_worker persistente (nasce na primeira fala, fica vivo
    pelo resto da execucao do server.py) — evita pagar import do piper/onnxruntime + carregar o
    modelo de voz do zero em toda fala, que era o maior gargalo de latencia da conversa."""
    import json
    # Pause wake-word/clap listening while the TTS plays out of the same Bluetooth
    # speaker the mic listens on — otherwise the assistant's own voice can retrigger it.
    _passive_listener_pause()
    try:
        proc = _get_tts_worker()
        with _tts_worker_lock:
            proc.stdin.write(json.dumps({"cmd": "speak", "text": text, "model": model_name}) + "\n")
            proc.stdin.flush()
        result = proc.stdout.readline().strip()
    finally:
        _passive_listener_resume()
    if result == "STOPPED" or result == "DONE":
        return  # interrompido de proposito (stop_speaking) nao e erro
    raise RuntimeError(result[6:] if result.startswith("ERROR ") else (result or "tts_worker nao respondeu"))


def stop_speaking():
    """Corta a fala em andamento, se houver — chamado quando o usuario aperta o botao 2 durante
    a reproducao. Idempotente: nao faz nada se nao tiver nenhum tts_worker rodando no momento."""
    import json
    with _tts_worker_lock:
        proc = _tts_worker_process
        if proc is None or proc.poll() is not None:
            return
        proc.stdin.write(json.dumps({"cmd": "stop"}) + "\n")
        proc.stdin.flush()


_speaker_worker_process = None
_speaker_worker_lock = threading.Lock()


def _spawn_speaker_worker():
    import subprocess
    import sys
    worker = Path(__file__).parent / "speaker_verify_worker.py"
    proc = subprocess.Popen(
        [sys.executable, str(worker)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1,
    )
    threading.Thread(target=_drain_stderr_named, args=(proc, "speaker_verify_worker"), daemon=True).start()
    return proc


def _drain_stderr_named(proc, name: str):
    try:
        for line in proc.stderr:
            if line.strip():
                print(f"[{name}] {line.rstrip()}", flush=True)
    except Exception:
        pass


def _get_speaker_worker():
    global _speaker_worker_process
    with _speaker_worker_lock:
        if _speaker_worker_process is None or _speaker_worker_process.poll() is not None:
            _speaker_worker_process = _spawn_speaker_worker()
        return _speaker_worker_process


@atexit.register
def _kill_speaker_worker():
    proc = _speaker_worker_process
    if proc is not None and proc.poll() is None:
        proc.kill()


def verify_speaker(wav_bytes: bytes, threshold: float = 0.75) -> dict:
    """Pergunta ao speaker_verify_worker se `wav_bytes` bate com o perfil de voz cadastrado
    (voice_profile.npy, gerado por enroll_voice.py). Retorna sempre um dict com pelo menos
    "has_profile" e "matched" — se ninguem rodou o cadastro ainda, "has_profile" vem False e
    "matched" vem True (nao bloqueia por padrao, so quem cadastrar de proposito ativa a
    checagem de verdade). Em caso de erro de comunicacao com o worker, tambem falha aberto
    (matched=True) — reconhecimento de locutor e conveniencia, nao trava o uso normal."""
    import base64
    import json
    wav_b64 = base64.b64encode(wav_bytes).decode("ascii")
    try:
        proc = _get_speaker_worker()
        with _speaker_worker_lock:
            proc.stdin.write(json.dumps({"cmd": "verify", "wav_b64": wav_b64, "threshold": threshold}) + "\n")
            proc.stdin.flush()
        line = proc.stdout.readline().strip()
        result = json.loads(line)
    except Exception as e:
        print(f"[jarvis] verify_speaker falhou, liberando por seguranca (fail-open): {e}", flush=True)
        return {"has_profile": False, "matched": True, "similarity": None}
    return result


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
    if params.get("denoise", True):
        pcm = reduce_noise_pcm(pcm, SAMPLE_RATE)
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
