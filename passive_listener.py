import threading
import time
from pathlib import Path

import numpy as np

CHUNK_MS = 30.0


class ClapDetector:
    """Distinguishes a double clap from speech by envelope shape, not content:
    a clap is a short, sharp energy spike (1-4 chunks above threshold, then back
    below) — sustained speech stays above threshold for many consecutive chunks.
    Two qualifying spikes within `pair_window_ms` of each other = a double clap.
    No ML — a hobby-grade heuristic, thresholds are meant to be tuned live."""

    def __init__(self, threshold_rms=4000.0, max_duration_ms=120.0,
                 pair_window_ms=(150.0, 700.0), chunk_ms=CHUNK_MS):
        self.threshold_rms = threshold_rms
        self.max_spike_chunks = max(1, int(max_duration_ms / chunk_ms))
        self.pair_window_min = pair_window_ms[0] / 1000.0
        self.pair_window_max = pair_window_ms[1] / 1000.0
        self._spike_chunks = 0
        self._last_clap_time = None

    def feed(self, rms: float, debug: bool = False) -> bool:
        """Feed one chunk's RMS energy. Returns True exactly when a double clap
        is confirmed (on the second qualifying spike)."""
        now = time.monotonic()

        if rms > self.threshold_rms:
            self._spike_chunks += 1
            return False

        spike_len = self._spike_chunks
        self._spike_chunks = 0
        if spike_len == 0:
            return False  # nothing above threshold ended on this chunk
        if spike_len > self.max_spike_chunks:
            if debug:
                print(f"[passive_listener] spike too long to be a clap: {spike_len} chunks "
                      f"(max {self.max_spike_chunks}) — likely speech", flush=True)
            return False
        if debug:
            print(f"[passive_listener] qualifying spike: {spike_len} chunk(s)", flush=True)

        if self._last_clap_time is not None:
            gap = now - self._last_clap_time
            if self.pair_window_min <= gap <= self.pair_window_max:
                self._last_clap_time = None
                if debug:
                    print(f"[passive_listener] DOUBLE CLAP CONFIRMED (gap {gap:.2f}s)", flush=True)
                return True
            if debug:
                print(f"[passive_listener] spike gap out of pair window: {gap:.2f}s "
                      f"(expected {self.pair_window_min:.2f}-{self.pair_window_max:.2f}s)", flush=True)
        self._last_clap_time = now
        return False


class WakeWordDetector:
    """Fala com wakeword_worker.py (subprocesso persistente) em vez de rodar o openWakeWord
    neste processo — onnxruntime conflita em nivel de PROCESSO (nao de thread) com as DLLs
    nativas do bleak/WinRT ja carregadas aqui (mesmo problema documentado pro Piper TTS em
    docs/04-arquitetura.md §4.8; a primeira versao disto tentou so uma thread separada e
    derrubava a thread inteira do passive_listener na primeira deteccao). `feed()` manda o
    audio cru pro worker; a deteccao em si chega assincrona via `on_trigger` (chamado de uma
    thread leitora dedicada, nao da thread que chama feed())."""

    def __init__(self, model_name: str, threshold: float = 0.5, on_trigger=None):
        import subprocess
        import sys
        worker = Path(__file__).parent / "wakeword_worker.py"
        self.model_name = model_name
        self.threshold = threshold
        self._on_trigger = on_trigger
        self._proc = subprocess.Popen(
            [sys.executable, str(worker), model_name, str(threshold)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        threading.Thread(target=self._read_triggers, daemon=True).start()
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _read_triggers(self):
        try:
            for line in self._proc.stdout:
                if line.strip() == b"TRIGGER" and self._on_trigger is not None:
                    self._on_trigger()
        except Exception:
            pass

    def _drain_stderr(self):
        # sem isso o pipe de stderr enche e trava a proxima escrita do worker — so precisa
        # ser lido, nao ha "erro real" esperado aqui em uso normal.
        try:
            for line in self._proc.stderr:
                if line.strip():
                    print(f"[wakeword_worker] {line.decode(errors='replace').rstrip()}", flush=True)
        except Exception:
            pass

    def feed(self, chunk: np.ndarray):
        if self._proc.poll() is not None:
            return  # worker morreu — sem respawn automatico por ora, so nao derruba esta thread
        try:
            self._proc.stdin.write(np.asarray(chunk, dtype=np.int16).tobytes())
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    def close(self):
        if self._proc.poll() is None:
            self._proc.kill()


class PassiveListener:
    """Background thread that subscribes to the shared mic (audio_capture) and
    watches for passive triggers (clap, later wake word). Triggers are reported
    via `on_trigger(gesture_key, note)`, which the caller (server.py) wires to
    fire_gesture() — the exact same dispatch path BLE button clicks already use."""

    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._pause_count = 0
        self._pause_lock = threading.Lock()
        self._config_provider = None
        self._on_trigger = None
        self._clap_detector: ClapDetector | None = None
        self._clap_cfg_snapshot = None
        self._wake_word_detector: WakeWordDetector | None = None
        self._wake_word_cfg_snapshot = None
        self._debug = False

    def start(self, config_provider, on_trigger):
        if self._thread is not None:
            return
        self._config_provider = config_provider
        self._on_trigger = on_trigger
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="passive_listener")
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
            self._thread = None

    def pause(self):
        with self._pause_lock:
            self._pause_count += 1

    def resume(self):
        with self._pause_lock:
            self._pause_count = max(0, self._pause_count - 1)

    def _is_paused(self) -> bool:
        with self._pause_lock:
            return self._pause_count > 0

    def _run(self):
        # Import aqui dentro (nao no topo do arquivo) de proposito: audio_capture importa
        # sounddevice, cuja inicializacao do WASAPI no Windows deixa a THREAD QUE FEZ O IMPORT
        # presa em COM modo STA ("Thread is configured for Windows GUI"). PassiveListener.start()
        # e chamado direto (sincrono) de dentro da coroutine ble_manager(), na thread do event
        # loop asyncio — se o import acontecesse la, toda reconexao BLE subsequente (bleak exige
        # MTA nessa mesma thread pro scanner WinRT) quebraria com esse erro exato. Importar aqui,
        # dentro de _run() (que roda na thread dedicada criada por threading.Thread), mantem a
        # contaminacao STA isolada nessa thread de audio, longe da thread do bleak.
        import audio_capture
        mgr = audio_capture.get_capture_manager()
        try:
            q = mgr.subscribe()
        except Exception as e:
            # sem nenhum dispositivo de entrada de audio disponivel (ex: Pi headless sem
            # microfone, e os oculos nao tem microfone Bluetooth utilizavel — ver achado da
            # depuracao do app Android) -- escuta passiva fica indisponivel, mas isso nao pode
            # derrubar o resto do servidor (BLE/gestos por botao continuam funcionando normal).
            print(f"[passive_listener] sem dispositivo de audio de entrada — escuta passiva "
                  f"desativada ({e})", flush=True)
            return
        debug_max_rms = 0.0
        debug_last_print = time.monotonic()
        try:
            while not self._stop_event.is_set():
                try:
                    chunk = q.get(timeout=1.0)
                except Exception:
                    continue

                cfg = (self._config_provider() or {}) if self._config_provider else {}
                pl_cfg = cfg.get("passive_listening", {})
                self._debug = bool(pl_cfg.get("debug_rms"))
                if not pl_cfg.get("enabled", False) or self._is_paused():
                    continue

                rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))

                if pl_cfg.get("debug_rms"):
                    debug_max_rms = max(debug_max_rms, rms)
                    now = time.monotonic()
                    if now - debug_last_print >= 1.0:
                        print(f"[passive_listener] rms peak (last 1s): {debug_max_rms:.0f}", flush=True)
                        debug_max_rms = 0.0
                        debug_last_print = now

                self._process_clap(pl_cfg.get("clap_detection", {}), rms)
                self._process_wake_word(pl_cfg.get("wake_word", {}), chunk)
        finally:
            mgr.unsubscribe(q)
            if self._wake_word_detector is not None:
                self._wake_word_detector.close()
                self._wake_word_detector = None

    def _process_clap(self, clap_cfg: dict, rms: float):
        if not clap_cfg.get("enabled", False):
            return
        if self._clap_detector is None or self._clap_cfg_snapshot != clap_cfg:
            self._clap_detector = ClapDetector(
                threshold_rms=float(clap_cfg.get("threshold_rms", 4000)),
                max_duration_ms=float(clap_cfg.get("max_duration_ms", 120)),
                pair_window_ms=tuple(clap_cfg.get("pair_window_ms", [150, 700])),
            )
            self._clap_cfg_snapshot = dict(clap_cfg)
        if self._clap_detector.feed(rms, debug=self._debug):
            gesture = clap_cfg.get("gesture", "button1_single")
            self._fire(gesture, "palma dupla detectada")

    def _process_wake_word(self, wake_cfg: dict, chunk):
        if not wake_cfg.get("enabled", False):
            if self._wake_word_detector is not None:
                self._wake_word_detector.close()
                self._wake_word_detector = None
                self._wake_word_cfg_snapshot = None
            return
        model_name = wake_cfg.get("model", "hey_jarvis")
        threshold = float(wake_cfg.get("threshold", 0.5))
        gesture = wake_cfg.get("gesture", "button1_single")
        snapshot = (model_name, threshold, gesture)
        # recria o worker (subprocesso — caro, carrega onnxruntime + pesos) so quando a config
        # muda de verdade, nao a cada chunk de 30ms.
        if self._wake_word_detector is None or self._wake_word_cfg_snapshot != snapshot:
            if self._wake_word_detector is not None:
                self._wake_word_detector.close()
            self._wake_word_detector = WakeWordDetector(
                model_name, threshold,
                on_trigger=lambda gk=gesture, mn=model_name: self._fire(
                    gk, f"palavra de ativacao detectada ({mn})"),
            )
            self._wake_word_cfg_snapshot = snapshot
        self._wake_word_detector.feed(chunk)

    def _fire(self, gesture_key: str, note: str):
        if self._on_trigger is not None:
            self._on_trigger(gesture_key, note)


_listener = PassiveListener()


def start(config_provider, on_trigger):
    _listener.start(config_provider, on_trigger)


def stop():
    _listener.stop()


def pause():
    _listener.pause()


def resume():
    _listener.resume()
