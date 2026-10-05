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
import sys
import threading
from pathlib import Path

BASE_DIR = Path(__file__).parent
ICON_PATH = BASE_DIR / "static" / "icon.png"

_icon = None


def _has_display() -> bool:
    """No Windows sempre ha uma area de trabalho pra bandeja. No Linux/macOS (X11/Wayland),
    so existe se as variaveis de ambiente correspondentes estiverem setadas -- ausentes numa
    sessao SSH sem ambiente grafico, como um Raspberry Pi headless. Sem essa checagem, cada
    tentativa falhava tarde (dentro do pystray/Tk) com uma mensagem confusa tipo
    'Bad display name \"\"' em vez de simplesmente nao tentar."""
    if sys.platform == "win32":
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def _open_dashboard(icon=None, item=None):
    import dashboard_launcher
    dashboard_launcher.open_dashboard()


def _open_orb(icon=None, item=None):
    import dashboard_launcher
    dashboard_launcher.open_orb()


def _quit(icon, item):
    icon.stop()
    os._exit(0)  # encerra o processo do servidor inteiro, nao so a bandeja


def _build_icon():
    import pystray
    from PIL import Image
    image = Image.open(ICON_PATH)
    menu = pystray.Menu(
        pystray.MenuItem("Abrir Wy Glass", _open_dashboard, default=True),
        pystray.MenuItem("Abrir no navegador", _open_orb),
        pystray.MenuItem("Sair", _quit),
    )
    return pystray.Icon("wyglass", image, "Wy Glass", menu)


def start():
    """Inicia o icone da bandeja numa thread dedicada — nao bloqueia o chamador. Falha
    silenciosamente (so loga) se pystray/Pillow nao estiverem disponiveis ou o ambiente nao
    tiver bandeja de sistema — nunca deve impedir o servidor de subir por causa disso."""
    if not _has_display():
        print("[tray_icon] sem ambiente grafico (headless) — icone da bandeja desativado", flush=True)
        return

    def _run():
        global _icon
        try:
            _icon = _build_icon()
            _icon.run()
        except Exception as e:
            print(f"[tray_icon] nao foi possivel iniciar o icone da bandeja: {e}", flush=True)

    threading.Thread(target=_run, daemon=True, name="tray_icon").start()
