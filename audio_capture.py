import queue
import threading

import sounddevice as sd

SAMPLE_RATE = 16000


class AudioCaptureManager:
    """A single persistent sd.InputStream, fanned out to N subscribers via queues.

    Needed because the glasses' classic-Bluetooth mic only accepts one exclusive
    capture stream at a time (Windows/WASAPI) — once wake word / clap detection
    listen continuously, record_audio_vad() can no longer open its own device
    stream on demand without stealing/losing the device from whoever else is
    listening. Every consumer subscribes to the same stream instead.
    """

    def __init__(self, samplerate: int = SAMPLE_RATE, chunk_ms: float = 30.0):
        self.samplerate = samplerate
        self.chunk_size = max(1, int(samplerate * chunk_ms / 1000))
        self._stream: sd.InputStream | None = None
        self._subscribers: list[queue.Queue] = []
        self._lock = threading.Lock()

    def _callback(self, indata, frames, time_info, status):
        chunk = indata.copy()
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(chunk)
            except queue.Full:
                # drop the oldest block rather than block the audio callback thread
                try:
                    q.get_nowait()
                except queue.Empty:
                    pass
                try:
                    q.put_nowait(chunk)
                except queue.Full:
                    pass

    def start(self):
        if self._stream is not None:
            return
        self._stream = sd.InputStream(
            samplerate=self.samplerate, channels=1, dtype="int16",
            blocksize=self.chunk_size, callback=self._callback,
        )
        self._stream.start()

    def stop(self):
        if self._stream is None:
            return
        self._stream.stop()
        self._stream.close()
        self._stream = None

    def subscribe(self, maxsize: int = 200) -> queue.Queue:
        self.start()
        q: queue.Queue = queue.Queue(maxsize=maxsize)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue):
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)


_manager: AudioCaptureManager | None = None
_manager_lock = threading.Lock()


def get_capture_manager() -> AudioCaptureManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = AudioCaptureManager()
        return _manager
