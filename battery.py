"""Bateria do Wy Glass, via o valor que o proprio Windows ja mantem em cache.

Nao existe characteristic BLE de bateria conhecida nesses oculos (nenhum servico padrao 0x180F
foi encontrado na descoberta GATT, ver docs/02-protocolo-ble.md) -- o numero que aparece em
Configuracoes > Bluetooth e dispositivos vem do perfil Bluetooth classico Hands-Free (HFP,
UUID 0000111E), que reporta bateria via indicador AT (AT+BIEV) de forma totalmente separada do
canal BLE proprietario que o resto deste projeto usa (ver docs/02-protocolo-ble.md secao 2.5
sobre AVRCP ser paralelo ao BLE -- HFP e o mesmo tipo de canal classico). O Windows guarda esse
valor na propriedade de dispositivo DEVPKEY_Bluetooth_Battery, exposta no no BTHENUM do
transporte Hands-Free AG (nao no no principal do dispositivo nem no transporte AVRCP -- os dois
foram testados e voltam vazios).
"""
import subprocess

DEVPKEY_BATTERY = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2"


def read_battery_percent(device_address: str, timeout: float = 10.0) -> int | None:
    """Le a porcentagem de bateria (0-100) cacheada pelo Windows para device_address, ou None
    se o Windows ainda nao tem esse dado (ex: nunca conectou via HFP) ou a chamada falhar."""
    mac = device_address.replace(":", "").replace("-", "").upper()
    ps_cmd = (
        "Get-PnpDevice | Where-Object { $_.InstanceId -match "
        f"'0000111E.*{mac}' }} "
        f"| Get-PnpDeviceProperty -KeyName '{DEVPKEY_BATTERY}' "
        "| Select-Object -ExpandProperty Data"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
            capture_output=True, text=True, timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    output = result.stdout.strip()
    if not output:
        return None
    try:
        return int(output.splitlines()[0].strip())
    except ValueError:
        return None
