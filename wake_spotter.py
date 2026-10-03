"""
wake_spotter.py — detector LOCAL de frases de ativacao pro modo pausa do Live.

Durante a pausa o usuario esta conversando com outra pessoa: nada desse audio pode ir pra nuvem.
Aqui o reconhecimento roda 100% offline (Vosk, modelo pequeno PT-BR) sobre o mesmo stream do mic
dos oculos, e so devolve "acordei" quando ouve uma das frases configuradas.

Por que reconhecimento livre + comparacao aproximada, e nao gramatica fechada: palavras fora do
vocabulario do modelo ("jarvis", "sankofa") somem da gramatica -- no reconhecimento livre elas
viram algo parecido ("em chaves"), e esse "como o Vosk ouve" pode ser cadastrado como apelido
(calibrar com a propria voz: calibrate()).
"""
import difflib
import json
import re
import unicodedata
from pathlib import Path

MODEL_DIR = Path(__file__).parent / "models" / "vosk-model-small-pt-0.3"
SAMPLE_RATE = 16000
MATCH_RATIO = 0.82

_model = None


def _get_model():
    global _model
    if _model is None:
        import vosk
        vosk.SetLogLevel(-1)
        if not MODEL_DIR.exists():
            raise RuntimeError(f"modelo Vosk ausente em {MODEL_DIR} (baixe vosk-model-small-pt-0.3)")
        _model = vosk.Model(str(MODEL_DIR))
    return _model


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text)).strip()


def contains_phrase(text: str, phrase: str, ratio: float = MATCH_RATIO) -> bool:
    """Frase (ou algo bem parecido) aparece em qualquer trecho do texto, palavra a palavra."""
    t, p = normalize(text).split(), normalize(phrase).split()
    if not t or not p:
        return False
    if " ".join(p) in " ".join(t):
        return True
    n = len(p)
    target = " ".join(p)
    for size in {max(1, n - 1), n, n + 1}:
        for i in range(0, max(1, len(t) - size + 1)):
            window = " ".join(t[i:i + size])
            if difflib.SequenceMatcher(None, window, target).ratio() >= ratio:
                return True
    return False


class WakeSpotter:
    def __init__(self, phrases: list[str], aliases: dict[str, list[str]] | None = None):
        import vosk
        self._vosk = vosk
        self.variants: list[tuple[str, str]] = []  # (frase original, como comparar)
        for ph in phrases:
            if not normalize(ph):
                continue
            self.variants.append((ph, ph))
            for alias in (aliases or {}).get(ph, []):
                if normalize(alias):
                    self.variants.append((ph, alias))
        self._rec = None
        self.reset()

    def reset(self):
        self._rec = self._vosk.KaldiRecognizer(_get_model(), SAMPLE_RATE)
        self.last_text = ""

    def feed(self, pcm16: bytes) -> str | None:
        """Alimenta um bloco PCM 16 kHz mono int16. Devolve a frase reconhecida, ou None. Usa o
        resultado parcial: a ativacao dispara enquanto a frase ainda esta sendo dita."""
        if self._rec.AcceptWaveform(pcm16):
            text = json.loads(self._rec.Result()).get("text", "")
        else:
            text = json.loads(self._rec.PartialResult()).get("partial", "")
        if not text or text == self.last_text:
            return None
        self.last_text = text
        for original, variant in self.variants:
            if contains_phrase(text, variant):
                self.reset()
                return original
        return None


def transcribe(pcm16: bytes) -> str:
    """Transcricao livre de um trecho curto -- usado na calibracao ("como o Vosk ouve voce")."""
    import vosk
    rec = vosk.KaldiRecognizer(_get_model(), SAMPLE_RATE)
    for i in range(0, len(pcm16), 3200):
        rec.AcceptWaveform(pcm16[i:i + 3200])
    return json.loads(rec.FinalResult()).get("text", "")
