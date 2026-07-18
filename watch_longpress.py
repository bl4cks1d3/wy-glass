import asyncio
from datetime import datetime
from bleak import BleakClient, BleakScanner

ADDRESS = "53:88:97:31:A5:3A"
NOTIFY_UUID = "0000ff03-0000-1000-8000-00805f9b34fb"

def ts():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

count = 0

def handler(sender, data: bytearray):
    global count
    count += 1
    b = bytes(data)
    print(f"[{ts()}] #{count} len={len(b)} hex={b.hex()}", flush=True)

async def main():
    device = await BleakScanner.find_device_by_address(ADDRESS, timeout=15.0)
    target = device if device else ADDRESS
    async with BleakClient(target) as client:
        print(f"[{ts()}] Connected: {client.is_connected}", flush=True)
        await client.start_notify(NOTIFY_UUID, handler)
        print(f"[{ts()}] READY — hold BUTTON 1 for 5-6 seconds now, then release", flush=True)
        await asyncio.sleep(60)

asyncio.run(main())
