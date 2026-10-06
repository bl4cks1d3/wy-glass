"""
Wy Glass — dashboard desktop: janela nativa do Windows (WebView2 via pywebview) mostrando o orb.

Antes era uma interface Tkinter separada (dashboard_classic.py), com visual proprio e cada
funcao reimplementada. Agora a janela desktop e o MESMO orb do modo web (/orb): orbe, Central
do Brain Office, paineis estruturados e ajustes -- uma interface so, sem divergir.

A janela nao tem moldura do Windows: ocupa a tela de ponta a ponta e os controles (flutuar,
minimizar, fechar) ficam no proprio orb. "Flutuar" troca a janela por um orb pequeno,
transparente e sempre por cima, que acompanha o usuario por todas as telas como um assistente:
clique fala com o Jarvis, duplo clique (ou o botao de expandir) volta pra tela cheia.

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
BUBBLE_SIZE = (200, 236)  # orbe com os aneis + etiqueta de estado embaixo
BUBBLE_MARGIN = 24


def work_area() -> tuple[float, float, float, float]:
    """Area util do monitor principal (sem a barra de tarefas) em unidades LOGICAS, as que
    move()/resize() do pywebview esperam. O pywebview liga o DPI awareness do processo, entao o
    Windows devolve pixels fisicos: com escala de 125% a bolha nascia fora da tela."""
    import ctypes
    from ctypes import wintypes
    u32 = ctypes.windll.user32
    r = wintypes.RECT()
    u32.SystemParametersInfoW(48, 0, ctypes.byref(r), 0)  # SPI_GETWORKAREA
    f = u32.GetDpiForSystem() / 96 if u32.IsProcessDPIAware() else 1
    return r.left / f, r.top / f, r.right / f, r.bottom / f


class ShellApi:
    """Exposta pro orb como window.pywebview.api (as duas janelas usam a mesma). Atributos com _
    ficam fora da ponte JS."""

    def __init__(self):
        self._main = None
        self._bubble = None
        self._maximized = "--janela" not in sys.argv

    def _bubble_window(self):
        import webview
        if self._bubble is None:
            w, h = BUBBLE_SIZE
            _, _, right, bottom = work_area()
            x, y = int(right - w - BUBBLE_MARGIN), int(bottom - h - BUBBLE_MARGIN)
            # criada sob demanda (e nao hidden=True no inicio): no WinForms a transparencia so
            # funciona no caminho de janela criada visivel
            self._bubble = webview.create_window(
                "Wy Glass · assistente", f"{ORB_URL}?mode=bubble", js_api=self, width=w, height=h,
                x=x, y=y, frameless=True, transparent=True, on_top=True, shadow=False,
                resizable=False, focus=False, background_color=BG_COLOR)
            # o WinForms desconta uma barra de titulo que a janela sem moldura nao tem: reaplica
            # o tamanho depois de aparecer
            self._bubble.events.shown += lambda: self._bubble.resize(w, h)
        else:
            self._bubble.show()
        return self._bubble

    def to_bubble(self):
        self._bubble_window()
        self._main.hide()

    def _fill(self):
        """"Maximizado" de janela sem moldura: ocupa a area util inteira, de ponta a ponta, sem
        cobrir a barra de tarefas (o Maximized do WinForms sem borda e instavel e cobre a barra)."""
        left, top, right, bottom = work_area()
        self._main.move(int(left), int(top))
        self._main.resize(int(right - left), int(bottom - top))

    def _windowed(self):
        left, top, right, bottom = work_area()
        w, h = WINDOW_SIZE
        self._main.resize(w, h)
        self._main.move(int(left + (right - left - w) / 2), int(top + (bottom - top - h) / 2))

    def expand(self):
        self._main.show()
        self._main.restore()  # se estava minimizada na barra
        self._fill() if self._maximized else self._windowed()
        if self._bubble is not None:
            self._bubble.hide()

    def minimize(self):
        self._main.minimize()

    def toggle_maximize(self):
        self._maximized = not self._maximized
        self._fill() if self._maximized else self._windowed()

    def close(self):
        if self._bubble is not None:
            self._bubble.destroy()
        self._main.destroy()


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
    api = ShellApi()
    api._main = webview.create_window(
        "Wy Glass", f"{ORB_URL}?shell=native", js_api=api, width=WINDOW_SIZE[0], height=WINDOW_SIZE[1],
        min_size=MIN_SIZE, background_color=BG_COLOR, text_select=True, frameless=True)
    api._main.events.shown += lambda: api._maximized and api._fill()
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
