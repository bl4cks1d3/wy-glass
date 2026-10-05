"""
Wy Glass — dashboard desktop: janela nativa do Windows (WebView2 via pywebview) mostrando o orb.

Antes era uma interface Tkinter separada (dashboard_classic.py), com visual proprio e cada
funcao reimplementada. Agora a janela desktop e o MESMO orb do modo web (/orb): orbe, Central
do Brain Office, paineis estruturados e ajustes -- uma interface so, sem divergir.

Sem pywebview (ou sem WebView2), cai pro Edge/Chrome em modo --app, que tambem abre sem barra
de navegador. `python dashboard.py --classico` ainda abre o dashboard Tkinter antigo.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

BASE_DIR = Path(__file__).parent
BASE_URL = "http://127.0.0.1:8731"
ORB_URL = f"{BASE_URL}/orb"
WINDOW_SIZE = (1240, 860)
MIN_SIZE = (420, 640)
# fundo da janela igual ao do orb (--bg do tema escuro): sem flash branco enquanto a pagina carrega
BG_COLOR = "#050507"
STORAGE_DIR = Path(os.environ.get("APPDATA", Path.home())) / "WyGlass" / "webview"


def _server_reachable() -> bool:
    try:
        requests.get(f"{BASE_URL}/api/status", timeout=1.5)
        return True
    except requests.RequestException:
        return False


def ensure_server_running():
    """Normalmente quem sobe o servidor e o Brain Office (servico wyglass). Se a janela for aberta
    sozinha e nao houver servidor, sobe um destacado, que continua vivo depois da janela fechar."""
    if _server_reachable():
        return
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    # DETACHED_PROCESS deixa o filho sem stdout: sem redirecionar, o print() do server.py derruba ele
    log = open(BASE_DIR / "server_launcher.log", "a", encoding="utf-8")
    subprocess.Popen([sys.executable, str(BASE_DIR / "server.py")], cwd=str(BASE_DIR), stdout=log,
                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    for _ in range(30):
        if _server_reachable():
            return
        time.sleep(0.5)


def open_native() -> bool:
    try:
        import webview
    except ImportError:
        return False
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    webview.create_window("Wy Glass", ORB_URL, width=WINDOW_SIZE[0], height=WINDOW_SIZE[1],
                          min_size=MIN_SIZE, background_color=BG_COLOR, text_select=True)
    # private_mode=False + storage_path: o tema escolhido e outras preferencias do orb (localStorage)
    # sobrevivem entre aberturas da janela
    webview.start(private_mode=False, storage_path=str(STORAGE_DIR), icon=str(BASE_DIR / "static" / "icon.ico"))
    return True


def open_app_mode():
    import dashboard_launcher
    dashboard_launcher.open_orb()


def main():
    if "--classico" in sys.argv:
        import dashboard_classic
        dashboard_classic.main()
        return
    ensure_server_running()
    try:
        if open_native():
            return
    except Exception as e:  # WebView2 ausente/quebrado: nao deixa o usuario sem dashboard
        print(f"[dashboard] janela nativa falhou ({e!r}); abrindo no modo app do navegador", flush=True)
    open_app_mode()


if __name__ == "__main__":
    main()
