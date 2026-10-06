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
FLOAT_SIZE = (460, 680)  # painel flutuante (agenda, cards dos agentes) por cima de qualquer app
FLOAT_MARGIN = 20
APP_ID = "WyGlass.Desktop"  # identidade propria na barra de tarefas (senao agrupa como pythonw)
MIN_SIZE = (420, 640)
# fundo da janela igual ao do orb (--bg do tema escuro): sem flash branco enquanto a pagina carrega
BG_COLOR = "#050507"
STORAGE_DIR = Path(os.environ.get("APPDATA", Path.home())) / "WyGlass" / "webview"


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
        self._float = None
        self._float_pending = None
        self._maximized = "--janela" not in sys.argv

    def _bubble_window(self):
        # janela nativa com alfa por pixel (bubble_native): a WebView2 nao fica transparente de
        # verdade no WinForms e deixava um quadrado em volta do circulo
        if self._bubble is None:
            import bubble_native
            self._bubble = bubble_native.Bubble(on_expand=self.expand)
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

    # -- painel flutuante: o que o Jarvis mostra aparece por cima do app em que o usuario esta,
    # sem abrir a janela cheia nem a Central inteira

    def _visible(self, win) -> bool:
        import ctypes
        try:
            return bool(win is not None and ctypes.windll.user32.IsWindowVisible(ctypes.c_void_p(win.native.Handle.ToInt64())))
        except Exception:
            return False

    def show_panel(self, payload: str) -> bool:
        """Chamado pelo orb quando o Jarvis manda mostrar algo; abre onde o usuario ja esta olhando:
        1) painel flutuante aberto -> nele (antes abria tambem na janela cheia e ficavam os dois);
        2) janela cheia na frente -> devolve False e o orb mostra ali mesmo; 3) senao, painel
        flutuante. Quem diz o que esta na frente e o Windows: a WebView2 continua achando que tem
        foco mesmo escondida."""
        import ctypes
        u32 = ctypes.windll.user32
        if self._visible(self._float):
            self.float_open(payload)
            return True
        try:
            hwnd = self._main.native.Handle.ToInt64()
            in_front = (u32.IsWindowVisible(ctypes.c_void_p(hwnd)) and not u32.IsIconic(ctypes.c_void_p(hwnd))
                        and u32.GetForegroundWindow() == hwnd)
        except Exception:
            in_front = False
        if in_front:
            return False
        self.float_open(payload)
        return True

    def float_open(self, payload: str):
        """payload: JSON {kind: central|card|tool, ...} montado pelo orb da janela principal."""
        import webview
        if self._float is None:
            left, top, right, bottom = work_area()
            w, h = FLOAT_SIZE[0], int(min(FLOAT_SIZE[1], bottom - top - 2 * FLOAT_MARGIN))
            self._float_pending = payload
            self._float = webview.create_window(
                "Wy Glass · painel", f"{ORB_URL}?mode=float", js_api=self, width=w, height=h,
                x=int(right - w - FLOAT_MARGIN), y=int(top + FLOAT_MARGIN), min_size=(360, 420),
                frameless=True, on_top=True, background_color=BG_COLOR, text_select=True)
            self._float.events.shown += lambda: self._float_shape(w, h)
            self._float.events.loaded += self._float_loaded
            return
        self._float.show()
        self._float.evaluate_js(f"window.__wyFloat({payload})")
        self._bring_front(self._float)

    @staticmethod
    def _bring_front(win):
        """Primeiro plano de verdade (foco), nao so por cima. O Windows nao deixa um app em segundo
        plano tomar o foco; anexando esta thread a da janela em foco, o SetForegroundWindow vale
        (sem simular tecla, que abriria o menu do app do usuario)."""
        import ctypes
        u32, k32 = ctypes.windll.user32, ctypes.windll.kernel32
        try:
            hwnd = ctypes.c_void_p(win.native.Handle.ToInt64())
        except Exception:
            return
        fg = u32.GetForegroundWindow()
        fg_tid = u32.GetWindowThreadProcessId(fg, None) if fg else 0
        me = k32.GetCurrentThreadId()
        attached = bool(fg_tid and fg_tid != me and u32.AttachThreadInput(me, fg_tid, True))
        try:
            if u32.IsIconic(hwnd):
                u32.ShowWindow(hwnd, 9)  # SW_RESTORE
            u32.BringWindowToTop(hwnd)
            u32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                u32.AttachThreadInput(me, fg_tid, False)

    def _float_loaded(self):
        if self._float_pending:
            payload, self._float_pending = self._float_pending, None
            self._float.evaluate_js(f"window.__wyFloat({payload})")

    def _float_shape(self, w: int, h: int):
        # o WinForms desconta uma barra de titulo que a janela sem moldura nao tem; e sem moldura
        # o Windows 11 nao arredonda os cantos sozinho -- pede pro DWM
        import ctypes
        self._float.resize(w, h)
        self._bring_front(self._float)
        try:
            hwnd = self._float.native.Handle.ToInt64()
            pref = ctypes.c_int(2)  # DWMWCP_ROUND
            ctypes.windll.dwmapi.DwmSetWindowAttribute(ctypes.c_void_p(hwnd), 33, ctypes.byref(pref), 4)
        except Exception as e:
            print(f"[dashboard] cantos arredondados: {e}", flush=True)

    def close_float(self):
        if self._float is not None:
            self._float.hide()

    def close(self):
        if self._bubble is not None:
            self._bubble.close()
        if self._float is not None:
            self._float.destroy()
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
    # Com o escritorio no ar e o servico wyglass ligado, quem sobe o servidor e o supervisor (ele pode
    # estar so reiniciando): subir um avulso aqui criava dois Wy Glass disputando porta e microfone.
    try:
        svcs = requests.get("http://127.0.0.1:3456/api/brain/services", timeout=2).json().get("services", [])
        if any(sv.get("id") == "wyglass" and sv.get("enabled") for sv in svcs):
            for _ in range(60):
                if _server_reachable():
                    return
                time.sleep(0.5)
            return
    except (requests.RequestException, ValueError):
        pass
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
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    except (AttributeError, OSError):
        pass
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
