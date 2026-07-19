"""
Icone na bandeja do sistema (system tray) do Windows para o servidor Wy Glass. Existe porque o
servidor normalmente roda oculto (pythonw.exe / start_all.py / DETACHED_PROCESS) — sem isso, uma
vez fechada a janela do Dashboard nao ha nenhum jeito visual de saber que o Wy Glass ainda esta
ativo, nem um atalho rapido pra reabrir o painel sem precisar achar o atalho de desktop de novo.

Roda numa thread dedicada (pystray.Icon.run() bloqueia a thread que chama, e precisa do proprio
loop de mensagens do Windows) — nunca na thread do event loop asyncio do servidor, mesmo motivo
ja documentado em server.py/passive_listener.py pra sounddevice: mais seguro manter qualquer
inicializacao de biblioteca nativa isolada em threads dedicadas.
"""

import os
import threading
from pathlib import Path

BASE_DIR = Path(__file__).parent
ICON_PATH = BASE_DIR / "static" / "icon.png"

_icon = None


def _open_dashboard(icon=None, item=None):
    import dashboard_launcher
    dashboard_launcher.open_dashboard()


def _quit(icon, item):
    icon.stop()
    os._exit(0)  # encerra o processo do servidor inteiro, nao so a bandeja


def _build_icon():
    import pystray
    from PIL import Image
    image = Image.open(ICON_PATH)
    menu = pystray.Menu(
        pystray.MenuItem("Abrir Dashboard", _open_dashboard, default=True),
        pystray.MenuItem("Sair", _quit),
    )
    return pystray.Icon("wyglass", image, "Wy Glass", menu)


def start():
    """Inicia o icone da bandeja numa thread dedicada — nao bloqueia o chamador. Falha
    silenciosamente (so loga) se pystray/Pillow nao estiverem disponiveis ou o ambiente nao
    tiver bandeja de sistema — nunca deve impedir o servidor de subir por causa disso."""
    def _run():
        global _icon
        try:
            _icon = _build_icon()
            _icon.run()
        except Exception as e:
            print(f"[tray_icon] nao foi possivel iniciar o icone da bandeja: {e}", flush=True)

    threading.Thread(target=_run, daemon=True, name="tray_icon").start()
