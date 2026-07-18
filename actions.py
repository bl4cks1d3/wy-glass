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
    wav_bytes = jarvis.pcm_to_wav_bytes(pcm, jarvis.SAMPLE_RATE)
    user_text = jarvis.ask_groq_whisper(groq_api_key, wav_bytes)
    if not user_text:
        raise RuntimeError("nao entendi o que voce disse")

    reply = smart_agent.process_turn(session_id, user_text, groq_api_key, user_name, user_role,
                                      tts_model, tavily_api_key=tavily_api_key)
    return f"jarvis: \"{reply}\""


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
    "open_dashboard": open_dashboard,
}


def run_action(action_type: str, params: dict) -> str:
    fn = ACTIONS.get(action_type)
    if fn is None:
        raise ValueError(f"tipo de acao desconhecido: {action_type}")
    return fn(params)
