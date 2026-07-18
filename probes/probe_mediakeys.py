import keyboard
from datetime import datetime

def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

KEYS = [
    "play/pause media", "next track media", "previous track media",
    "stop media", "volume up", "volume down", "volume mute",
]

for k in KEYS:
    def make(k):
        def cb(e):
            print(f"[{ts()}] KEY: {k}", flush=True)
        return cb
    try:
        keyboard.on_press_key(k, make(k), suppress=False)
    except Exception as ex:
        print(f"could not hook {k}: {ex}", flush=True)

print("READY — test single / double / long press now", flush=True)
keyboard.wait()
