import asyncio
import json
import subprocess
import sys
import time
import webbrowser
from datetime import datetime
from pathlib import Path


def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

from bleak import BleakClient, BleakScanner

CONFIG_PATH = Path(__file__).parent / "config.json"

IGNORE_WINDOW_AFTER_CONNECT = 2.0   # skip the connection-status echo notification
DEBOUNCE_SECONDS = 1.0              # ignore repeat triggers fired too close together


def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def run_action(action: dict):
    kind = action.get("action")
    try:
        if kind == "run_command":
            command = action["command"]
            args = action.get("args", [])
            subprocess.Popen([command, *args], shell=False)
        elif kind == "open_url":
            webbrowser.open(action["url"])
        elif kind == "key_shortcut":
            import keyboard
            keyboard.send(action["keys"])
        else:
            print(f"[!] Unknown action type: {kind}")
    except Exception as e:
        print(f"[!] Action failed: {e}")


class GlassesButton:
    def __init__(self, config):
        self.address = config["device_address"]
        self.notify_uuid = config["notify_char_uuid"]
        self.on_click = config["on_click"]
        self.connected_at = None
        self.last_trigger = 0.0

    def handle_notification(self, sender, data: bytearray):
        b = bytes(data)
        now = time.monotonic()

        if now - self.connected_at < IGNORE_WINDOW_AFTER_CONNECT:
            return

        if b[:2] != bytes.fromhex("bc07"):
            return  # not a click event (telemetry, voice-session frames, etc.)

        if now - self.last_trigger < DEBOUNCE_SECONDS:
            return
        self.last_trigger = now

        print(f"[{ts()}] [click] {b.hex()} -> running configured action")
        run_action(self.on_click)
        print(f"[{ts()}] action dispatched")

    async def run_forever(self):
        while True:
            try:
                print(f"Scanning for {self.address} ...")
                device = await BleakScanner.find_device_by_address(self.address, timeout=15.0)
                if device is None:
                    print("Not found (out of range / off?). Retrying in 10s...")
                    await asyncio.sleep(10)
                    continue

                disconnected = asyncio.Event()

                async with BleakClient(device, disconnected_callback=lambda c: disconnected.set()) as client:
                    print(f"Connected to {self.address}")
                    self.connected_at = time.monotonic()

                    await client.start_notify(self.notify_uuid, self.handle_notification)
                    print("Listening for button clicks...")

                    await disconnected.wait()
                    print("Disconnected. Reconnecting...")

            except Exception as e:
                print(f"[!] Connection error: {e}. Retrying in 5s...")
                await asyncio.sleep(5)


async def main():
    config = load_config()
    button = GlassesButton(config)
    await button.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
