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


def open_jarvis_agent(params: dict):
    """Unified smart agent (former separate Open Jarvis process, merged in):
    records via the shared mic, transcribes with Groq Whisper, thinks with Groq
    (with search/browse/open/screen/news tool-calling), speaks the reply — all
    in this one process, no HTTP bridge to anywhere."""
    import jarvis
    import smart_agent

    groq_api_key = params.get("groq_api_key")
    if not groq_api_key:
        raise ValueError("groq_api_key nao configurado pro open_jarvis_agent")
    session_id = params.get("session_id", "wyglass")
    user_name = params.get("user_name", "sankofa")
    user_role = params.get("user_role", "desenvolvedor e engenheiro de bugigangas tech")
    tts_model = params.get("tts_model", "pt_BR-faber-medium.onnx")
    tavily_api_key = params.get("tavily_api_key", "")

    if session_id not in smart_agent.conversations:
        smart_agent.conversations[session_id] = []
        jarvis.speak(smart_agent.greeting_text(user_name), tts_model)

    capture_manager = jarvis.get_capture_manager()
    pcm = jarvis.record_audio_vad(
        capture_manager=capture_manager,
        max_duration=float(params.get("max_duration_seconds", 15)),
        silence_duration=float(params.get("silence_duration_seconds", 1.0)),
        silence_threshold=float(params.get("silence_threshold", 300)),
    )
    if params.get("denoise", True):
        pcm = jarvis.reduce_noise_pcm(pcm, jarvis.SAMPLE_RATE)
    wav_bytes = jarvis.pcm_to_wav_bytes(pcm, jarvis.SAMPLE_RATE)

    if params.get("require_speaker_match"):
        # gate especifico do gatilho por wake word (ver config.json > passive_listening.wake_word
        # e a gesture "wake_word_command") — o clique fisico do botao NAO passa por aqui, ja que
        # pressionar o botao ja e, por definicao, uma acao intencional. So bloqueia se ja existe
        # um perfil cadastrado (enroll_voice.py) — sem cadastro, verify_speaker() falha aberto.
        check = jarvis.verify_speaker(wav_bytes, threshold=float(params.get("speaker_match_threshold", 0.75)))
        if check.get("has_profile") and not check.get("matched"):
            sim = check.get("similarity")
            print(f"[actions] wake word ignorada — voz nao reconhecida (similaridade "
                  f"{sim:.2f} < limiar)" if sim is not None else "[actions] wake word ignorada — voz nao reconhecida",
                  flush=True)
            return "ignorado: voz nao reconhecida"

    user_text = jarvis.ask_groq_whisper(groq_api_key, wav_bytes)
    if not user_text:
        raise RuntimeError("nao entendi o que voce disse")

    reply = smart_agent.process_turn(session_id, user_text, groq_api_key, user_name, user_role,
                                      tts_model, tavily_api_key=tavily_api_key)
    return f"jarvis: \"{reply}\""


def translator_agent(params: dict):
    """Grava uma fala em qualquer idioma (Whisper com deteccao automatica, sem forcar
    'pt' como o resto do app faz) e fala a traducao em voz alta. Bidirecional: fala
    em portugues sai traduzida em ingles (voz en_US-lessac-medium), fala em qualquer
    outro idioma sai traduzida em portugues (voz pt_BR-faber-medium) — a direcao e
    decidida pelo idioma que o Whisper detectou, nao por configuracao fixa. Turno
    unico, sem historico/sessao — foco em ser rapido tipo 'o que essa pessoa falou'."""
    import jarvis
    import smart_agent

    groq_api_key = params.get("groq_api_key")
    if not groq_api_key:
        raise ValueError("groq_api_key nao configurado pro translator_agent")
    pt_tts_model = params.get("pt_tts_model", "pt_BR-faber-medium.onnx")
    en_tts_model = params.get("en_tts_model", "en_US-lessac-medium.onnx")

    capture_manager = jarvis.get_capture_manager()
    pcm = jarvis.record_audio_vad(
        capture_manager=capture_manager,
        max_duration=float(params.get("max_duration_seconds", 15)),
        silence_duration=float(params.get("silence_duration_seconds", 1.0)),
        silence_threshold=float(params.get("silence_threshold", 400)),
    )
    if params.get("denoise", True):
        pcm = jarvis.reduce_noise_pcm(pcm, jarvis.SAMPLE_RATE)
    wav_bytes = jarvis.pcm_to_wav_bytes(pcm, jarvis.SAMPLE_RATE)
    stt = jarvis.ask_groq_whisper(groq_api_key, wav_bytes, language=None, detect_language=True)
    original_text = stt["text"]
    if not original_text:
        raise RuntimeError("nao entendi o que foi falado")

    # idioma detectado pelo Whisper vem por extenso ("portuguese", "english", etc) — so
    # precisamos distinguir "veio em portugues" de "veio em qualquer outra coisa", entao
    # nao precisamos de uma tabela completa de idiomas aqui.
    source_is_portuguese = "portu" in stt["language"].lower()
    target_language = "ingles americano" if source_is_portuguese else "portugues do Brasil"
    tts_model = en_tts_model if source_is_portuguese else pt_tts_model

    message = smart_agent.ask_groq(
        groq_api_key,
        system_prompt=(
            f"Voce e um tradutor. Traduza o texto do usuario para {target_language}, de forma "
            "natural e fiel ao sentido original. Responda APENAS com a traducao — sem aspas, "
            "sem comentarios, sem explicar o que fez."
        ),
        messages=[{"role": "user", "content": original_text}],
        max_tokens=300,
    )
    translated_text = (message.get("content") or "").strip()
    if not translated_text:
        raise RuntimeError("nao consegui traduzir")

    jarvis.speak(translated_text, tts_model)
    return f"traduzido ({target_language}): \"{original_text}\" -> \"{translated_text}\""


def open_dashboard(params: dict):
    import dashboard_launcher
    return dashboard_launcher.open_dashboard()


ACTIONS = {
    "run_command": run_command,
    "open_url": open_url,
    "key_shortcut": key_shortcut,
    "screenshot": screenshot,
    "voice_command": voice_command,
    "jarvis_voice_agent": jarvis_voice_agent,
    "open_jarvis_agent": open_jarvis_agent,
    "translator_agent": translator_agent,
    "open_dashboard": open_dashboard,
}


def run_action(action_type: str, params: dict) -> str:
    fn = ACTIONS.get(action_type)
    if fn is None:
        raise ValueError(f"tipo de acao desconhecido: {action_type}")
    return fn(params)
