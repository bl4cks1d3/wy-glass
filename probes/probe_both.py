import asyncio
from datetime import datetime
from bleak import BleakClient, BleakScanner

ADDRESS = "53:88:97:31:A5:3A"
FF_NOTIFY = "0000ff03-0000-1000-8000-00805f9b34fb"
AE_NOTIFY = "0000ae02-0000-1000-8000-00805f9b34fb"
CC_NOTIFY = "c551c36a-0377-4a29-9657-74ffb655a188"

def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

def make_handler(label):
    def handler(sender, data: bytearray):
        b = bytes(data)
        print(f"[{ts()}] [{label}] len={len(b)} hex={b.hex()}", flush=True)
    return handler

async def main():
    device = await BleakScanner.find_device_by_address(ADDRESS, timeout=15.0)
    target = device if device else ADDRESS
    async with BleakClient(target) as client:
        print(f"Connected: {client.is_connected}", flush=True)

        for uuid, label in [(FF_NOTIFY, "FF"), (AE_NOTIFY, "AE"), (CC_NOTIFY, "CC")]:
            try:
                await client.start_notify(uuid, make_handler(label))
                print(f"Subscribed to {label} ({uuid})", flush=True)
            except Exception as e:
                print(f"Could not subscribe to {label}: {e}", flush=True)

        print("READY — press the button now (single click)", flush=True)
        await asyncio.sleep(90)

asyncio.run(main())
