import asyncio
import threading
from datetime import datetime
from bleak import BleakClient, BleakScanner
import keyboard

ADDRESS = "53:88:97:31:A5:3A"
NOTIFY_UUID = "0000ff03-0000-1000-8000-00805f9b34fb"

def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

def ble_handler(sender, data: bytearray):
    print(f"[{ts()}] [BLE] hex={bytes(data).hex()}", flush=True)

def make_key_handler(name):
    def cb(e):
        print(f"[{ts()}] [KEY] {name}", flush=True)
    return cb

def start_keyboard_hooks():
    for k in ["play/pause media", "stop media", "volume up", "volume down", "volume mute"]:
        try:
            keyboard.on_press_key(k, make_key_handler(k), suppress=False)
        except Exception as ex:
            print(f"could not hook {k}: {ex}", flush=True)
    keyboard.wait()

async def ble_main():
    device = await BleakScanner.find_device_by_address(ADDRESS, timeout=15.0)
    target = device if device else ADDRESS
    async with BleakClient(target) as client:
        print(f"[{ts()}] BLE Connected: {client.is_connected}", flush=True)
        await client.start_notify(NOTIFY_UUID, ble_handler)
        print(f"[{ts()}] READY — press BUTTON 1 alone, wait 5s, then BUTTON 2 alone", flush=True)
        await asyncio.sleep(120)

threading.Thread(target=start_keyboard_hooks, daemon=True).start()
asyncio.run(ble_main())
