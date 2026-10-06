"""
bubble_native.py — o orb flutuante do Wy Glass: um circulo de verdade sobre a area de trabalho.

Por que nativo e nao WebView: a WebView2 dentro de uma janela WinForms nao compoe transparencia
por pixel com a area de trabalho -- com transparent=True, recorte (SetWindowRgn) ou cor-chave
(TransparencyKey) sobra sempre um quadrado opaco em volta do circulo. Aqui a janela e uma
"layered window" (UpdateLayeredWindow): cada pixel leva o proprio alfa, a borda do circulo sai
suave e fora dele o clique atravessa pra janela de baixo.

O desenho segue o orb do modo web (vidro escuro, fluido de cor do estado, luz caindo de cima como
na Siri) e e feito com numpy. O estado vem do WebSocket do
servidor (/ws), o mesmo que o orb usa.

Interacao: clique liga/desliga o Live; duplo clique (ou o botao de expandir que aparece no hover)
abre a janela cheia; arrastar move; no hover, com o Live rodando, aparece o botao de pausa.
"""
import ctypes
import json
import math
import threading
import time
from ctypes import wintypes

import numpy as np
import requests
from PIL import Image, ImageDraw

BASE_URL = "http://127.0.0.1:8731"
WS_URL = "ws://127.0.0.1:8731/ws"
DIAMETER = 96  # pt (logico); em pixels fisicos depende da escala do Windows
MARGIN = 28
FPS = 30

PALETTES = {
    "idle": [[94, 92, 230], [64, 156, 255], [175, 110, 240], [90, 200, 250]],
    "connecting": [[90, 150, 255], [120, 110, 255], [80, 200, 255], [150, 120, 255]],
    "listening": [[10, 132, 255], [48, 209, 255], [94, 92, 230], [100, 210, 255]],
    "working": [[191, 90, 242], [94, 92, 230], [255, 55, 95], [120, 100, 255]],
    "speaking": [[255, 55, 95], [255, 159, 10], [191, 90, 242], [255, 100, 140]],
    "error": [[255, 69, 58], [255, 120, 90], [200, 60, 80], [255, 90, 60]],
    "paused": [[200, 140, 70], [150, 110, 80], [175, 125, 90], [120, 100, 85]],
}

# ---- Win32 ---------------------------------------------------------------------------------
u32 = ctypes.WinDLL("user32", use_last_error=True)
gdi = ctypes.WinDLL("gdi32", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

WS_POPUP = 0x80000000
WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x80000, 0x8, 0x80, 0x08000000
CS_DBLCLKS = 0x8
WM_DESTROY, WM_TIMER, WM_MOUSEMOVE = 0x0002, 0x0113, 0x0200
WM_LBUTTONDOWN, WM_LBUTTONUP, WM_LBUTTONDBLCLK = 0x0201, 0x0202, 0x0203
WM_MOUSEACTIVATE, WM_MOUSELEAVE, WM_SETCURSOR = 0x0021, 0x02A3, 0x0020
WM_APP = 0x8000
MSG_SHOW, MSG_HIDE, MSG_QUIT = WM_APP + 1, WM_APP + 2, WM_APP + 3
MA_NOACTIVATE = 3
SW_HIDE, SW_SHOWNOACTIVATE = 0, 4
SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x1, 0x4, 0x10
ULW_ALPHA, AC_SRC_OVER, AC_SRC_ALPHA = 0x2, 0x0, 0x1
TME_LEAVE = 0x2
TIMER_FRAME, TIMER_CLICK = 1, 2
IDC_HAND = 32649


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("style", wintypes.UINT), ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE),
                ("hIcon", wintypes.HICON), ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR), ("hIconSm", wintypes.HICON)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
                ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte),
                ("SourceConstantAlpha", ctypes.c_ubyte), ("AlphaFormat", ctypes.c_ubyte)]


class TRACKMOUSEEVENT(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("hwndTrack", wintypes.HWND), ("dwHoverTime", wintypes.DWORD)]


def _sig(fn, res, *args):
    fn.restype, fn.argtypes = res, list(args)


_sig(u32.DefWindowProcW, LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
_sig(u32.RegisterClassExW, wintypes.ATOM, ctypes.POINTER(WNDCLASSEXW))
_sig(u32.CreateWindowExW, wintypes.HWND, wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
     ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.HMENU,
     wintypes.HINSTANCE, wintypes.LPVOID)
_sig(u32.UpdateLayeredWindow, wintypes.BOOL, wintypes.HWND, wintypes.HDC, ctypes.POINTER(wintypes.POINT),
     ctypes.POINTER(wintypes.SIZE), wintypes.HDC, ctypes.POINTER(wintypes.POINT), wintypes.DWORD,
     ctypes.POINTER(BLENDFUNCTION), wintypes.DWORD)
_sig(u32.GetDC, wintypes.HDC, wintypes.HWND)
_sig(u32.SetWindowPos, wintypes.BOOL, wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
     ctypes.c_int, ctypes.c_int, wintypes.UINT)
_sig(u32.GetWindowRect, wintypes.BOOL, wintypes.HWND, ctypes.POINTER(wintypes.RECT))
_sig(u32.PostMessageW, wintypes.BOOL, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
_sig(u32.ShowWindow, wintypes.BOOL, wintypes.HWND, ctypes.c_int)
_sig(u32.SetTimer, ctypes.c_size_t, wintypes.HWND, ctypes.c_size_t, wintypes.UINT, wintypes.LPVOID)
_sig(u32.KillTimer, wintypes.BOOL, wintypes.HWND, ctypes.c_size_t)
_sig(u32.SetCapture, wintypes.HWND, wintypes.HWND)
_sig(u32.LoadCursorW, wintypes.HANDLE, wintypes.HINSTANCE, wintypes.LPVOID)
_sig(u32.SetCursor, wintypes.HANDLE, wintypes.HANDLE)
_sig(u32.TrackMouseEvent, wintypes.BOOL, ctypes.POINTER(TRACKMOUSEEVENT))
_sig(u32.GetMessageW, wintypes.BOOL, ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT)
_sig(u32.DispatchMessageW, LRESULT, ctypes.POINTER(wintypes.MSG))
_sig(gdi.CreateCompatibleDC, wintypes.HDC, wintypes.HDC)
_sig(gdi.CreateDIBSection, wintypes.HBITMAP, wintypes.HDC, ctypes.POINTER(BITMAPINFOHEADER), wintypes.UINT,
     ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD)
_sig(gdi.SelectObject, wintypes.HGDIOBJ, wintypes.HDC, wintypes.HGDIOBJ)
_sig(u32.DestroyWindow, wintypes.BOOL, wintypes.HWND)
_sig(k32.GetModuleHandleW, wintypes.HMODULE, wintypes.LPCWSTR)


def _xy(lparam: int) -> tuple[int, int]:
    return ctypes.c_short(lparam & 0xFFFF).value, ctypes.c_short((lparam >> 16) & 0xFFFF).value


# ---- desenho --------------------------------------------------------------------------------
class Renderer:
    """Mesma receita do drawBubble do orb.html, em numpy, em 1x: a borda do circulo e os aneis
    sao suavizados analiticamente (cobertura pela distancia ao contorno), o que basta pra um
    antialias limpo sem supersampling -- um quadro custa poucos ms. Cor pre-multiplicada no fim
    (UpdateLayeredWindow exige)."""

    def __init__(self, px: int, scale: float):
        self.px, self.scale = px, scale
        y, x = np.mgrid[0:px, 0:px].astype(np.float32) + 0.5
        self.x, self.y = x, y
        self.cx = self.cy = px / 2
        self.r = px / 2 - 1  # 1 px de folga pra borda antialiased caber
        self.d = np.hypot(x - self.cx, y - self.cy)
        self.mask = np.clip(self.r - self.d + 0.5, 0, 1)[..., None]
        # partes fixas: vidro escuro (mais claro no alto), reflexo especular e borda escurecida
        t = np.clip(np.hypot(x - self.cx, y - (self.cy - 0.25 * self.r)) / self.r, 0, 1)[..., None]
        c0, c1 = np.array([22, 26, 48], np.float32) / 255, np.array([5, 6, 12], np.float32) / 255
        self.base = c0 * (1 - t) + c1 * t
        dd = np.hypot(x - self.cx, (y - (self.cy - 0.55 * self.r)) / 0.6) / (0.7 * self.r)
        self.spec = np.where(dd < 0.5, 0.26 + (0.09 - 0.26) * dd / 0.5,
                             np.where(dd < 1, 0.09 * (1 - (dd - 0.5) / 0.5), 0)).astype(np.float32)[..., None]
        self.rim = (0.5 * np.clip((self.d - 0.7 * self.r) / (0.3 * self.r), 0, 1)).astype(np.float32)[..., None]
        self.glyph_r = 12 * scale
        self.expand_c = (self.cx, self.cy - self.r + 10 * scale + self.glyph_r)
        self.pause_c = (self.cx, self.cy + self.r - 10 * scale - self.glyph_r)
        self._glyph_cache: dict = {}

    def _ring(self, radius: float, width: float, alpha: float) -> np.ndarray:
        return (np.clip(width / 2 + 0.5 - np.abs(self.d - radius), 0, 1) * alpha)[..., None]

    def _glyphs(self, show_pause: bool, paused: bool) -> np.ndarray:
        """Botoes do hover (vidro claro + icone), desenhados em 4x com PIL e reduzidos; cache por
        combinacao, sao so tres."""
        key = (show_pause, paused)
        if key in self._glyph_cache:
            return self._glyph_cache[key]
        k = 4
        n, s = self.px * k, self.scale * k
        img = Image.new("L", (n, n), 0)
        dr = ImageDraw.Draw(img)
        gr = self.glyph_r * k

        def disc(c):
            dr.ellipse((c[0] * k - gr, c[1] * k - gr, c[0] * k + gr, c[1] * k + gr), fill=52)

        disc(self.expand_c)
        ex, ey = self.expand_c[0] * k, self.expand_c[1] * k
        w, a = max(2, round(1.6 * s)), 4.6 * s  # setas de expandir (diagonal)
        for sx, sy in ((1, -1), (-1, 1)):
            tip = (ex + sx * a, ey + sy * a)
            dr.line((ex + sx * 1.2 * s, ey + sy * 1.2 * s, *tip), fill=255, width=w)
            dr.line((tip[0] - sx * 3.2 * s, tip[1], *tip), fill=255, width=w)
            dr.line((tip[0], tip[1] - sy * 3.2 * s, *tip), fill=255, width=w)
        if show_pause:
            disc(self.pause_c)
            px_, py_ = self.pause_c[0] * k, self.pause_c[1] * k
            if paused:  # play
                dr.polygon(((px_ - 3 * s, py_ - 4.5 * s), (px_ - 3 * s, py_ + 4.5 * s), (px_ + 4.5 * s, py_)), fill=255)
            else:
                for off in (-2.6 * s, 2.6 * s):
                    dr.rectangle((px_ + off - 1.2 * s, py_ - 4.5 * s, px_ + off + 1.2 * s, py_ + 4.5 * s), fill=255)
        layer = (np.asarray(img.resize((self.px, self.px), Image.BOX), dtype=np.float32) / 255)[..., None]
        self._glyph_cache[key] = layer
        return layer

    def frame(self, t: float, palette, status: str, running: bool, energy: float, hover: bool) -> bytes:
        rgb = self.base.copy()
        speed = 1.6 if status == "working" else 0.25 if status == "paused" else 1.0 if running else 0.5
        dim = 0.55 if status == "paused" else 1.0 if running else 0.72
        r, cx, cy = self.r, self.cx, self.cy
        for i in range(4):
            a = t * speed * (0.5 + i * 0.21) + i * 1.9
            wob = 0.36 + energy * 0.3
            bx = cx + math.cos(a) * r * wob * (0.75 if i % 2 else 1)
            by = cy + r * 0.14 + math.sin(a * 1.27 + i) * r * wob  # cor mais pra baixo, luz em cima
            br = r * (0.8 + 0.18 * math.sin(t * 0.8 + i) + energy * 0.35)
            dd = np.hypot(self.x - bx, self.y - by) * (1 / br)
            al = np.interp(dd, (0, 0.6, 1), (0.85 * dim, 0.2 * dim, 0)).astype(np.float32)
            rgb += (np.array(palette[i], np.float32) / 255) * al[..., None]  # "lighter": soma
        np.clip(rgb, 0, 1, out=rgb)
        rgb = rgb * (1 - self.spec) + self.spec
        rgb *= 1 - self.rim
        ring = self._ring(r - 1.5 * self.scale, 1.0, 0.22 if running else 0.14)  # fio de luz do vidro
        rgb = rgb * (1 - ring) + ring
        if status in ("listening", "speaking"):  # anel de voz
            voice = self._ring(r * 0.86 - energy * r * 0.06, (1 + energy * 1.5) * self.scale, 0.06 + energy * 0.28)
            rgb = rgb * (1 - voice) + voice
        if hover:
            g = self._glyphs(running and status != "connecting", status == "paused")
            rgb = rgb * (1 - g) + g
        out = np.concatenate([rgb * self.mask, self.mask], axis=2)  # pre-multiplicado
        return (out[..., [2, 1, 0, 3]] * 255 + 0.5).astype(np.uint8).tobytes()

    def hit(self, x: int, y: int, center) -> bool:
        return math.hypot(x - center[0], y - center[1]) <= self.glyph_r * 1.3


# ---- janela ---------------------------------------------------------------------------------
class Bubble:
    """Roda numa thread propria (janela + loop de mensagens Win32). show()/hide()/close() podem ser
    chamados de qualquer thread."""

    def __init__(self, on_expand):
        self.on_expand = on_expand
        self.hwnd = None
        self.visible = False
        self.status, self.running = "idle", False
        self.in_level = self.out_level = self.in_s = self.out_s = 0.0
        self.palette = [c[:] for c in PALETTES["idle"]]
        self.hover = False
        self._drag = None  # (cursor0, janela0, moveu?)
        self._after_dbl = False  # o "soltar" que segue o duplo clique nao e um clique simples
        self._ready = threading.Event()
        self._closed = False
        self._t0 = time.monotonic()
        threading.Thread(target=self._run, name="wy-bubble", daemon=True).start()
        threading.Thread(target=self._listen, name="wy-bubble-ws", daemon=True).start()
        self._ready.wait(5)

    # -- API pra outras threads
    def show(self):
        if self.hwnd:
            u32.PostMessageW(self.hwnd, MSG_SHOW, 0, 0)

    def hide(self):
        if self.hwnd:
            u32.PostMessageW(self.hwnd, MSG_HIDE, 0, 0)

    def close(self):
        self._closed = True
        if self.hwnd:
            u32.PostMessageW(self.hwnd, MSG_QUIT, 0, 0)

    # -- estado do Live (WebSocket do servidor)
    def _apply(self, m: dict):
        kind = m.get("type")
        if kind == "live_state":
            self.status = m.get("status") if m.get("status") in PALETTES else "idle"
            self.running = self.status not in ("idle", "error")
        elif kind == "live_level":
            self.in_level = max(self.in_level, float(m.get("in") or 0))
            self.out_level = max(self.out_level, float(m.get("out") or 0))
        elif kind in ("live_central", "live_card") and self.visible:
            self.on_expand()  # o agente quer mostrar algo: a janela cheia abre

    def _listen(self):
        from websockets.sync.client import connect
        while not self._closed:
            try:
                st = requests.get(f"{BASE_URL}/api/live", timeout=3).json().get("status", "idle")
                self._apply({"type": "live_state", "status": st})
                with connect(WS_URL, open_timeout=5) as ws:
                    for raw in ws:
                        if self._closed:
                            return
                        try:
                            self._apply(json.loads(raw))
                        except (ValueError, TypeError):
                            pass
            except Exception:
                time.sleep(2)

    def _post(self, path: str):
        threading.Thread(target=lambda: requests.post(f"{BASE_URL}{path}", json={}, timeout=10),
                         daemon=True).start()

    def _toggle_live(self):
        if not self.running:
            self.status, self.running = "connecting", True
        self._post("/api/live/stop" if self.running and self.status != "connecting" else "/api/live/start")

    # -- loop Win32
    def _run(self):
        try:  # pixels fisicos nesta thread: tamanho, posicao e mouse na mesma unidade
            u32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
        except AttributeError:
            pass
        scale = u32.GetDpiForSystem() / 96
        px = round(DIAMETER * scale)
        self.renderer = Renderer(px, scale)
        hinst = k32.GetModuleHandleW(None)
        self._wndproc = WNDPROC(self._proc)  # referencia viva: o Windows chama de volta
        wc = WNDCLASSEXW(cbSize=ctypes.sizeof(WNDCLASSEXW), style=CS_DBLCLKS, lpfnWndProc=self._wndproc,
                         hInstance=hinst, hCursor=u32.LoadCursorW(None, ctypes.c_void_p(IDC_HAND)),
                         lpszClassName="WyGlassBubble")
        u32.RegisterClassExW(ctypes.byref(wc))
        area = wintypes.RECT()
        u32.SystemParametersInfoW(48, 0, ctypes.byref(area), 0)  # area util, sem a barra de tarefas
        margin = round(MARGIN * scale)
        self.hwnd = u32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, "WyGlassBubble",
            "Wy Glass · assistente", WS_POPUP, area.right - px - margin, area.bottom - px - margin,
            px, px, None, None, hinst, None)
        self._screen_dc = u32.GetDC(None)
        self._mem_dc = gdi.CreateCompatibleDC(self._screen_dc)
        bmi = BITMAPINFOHEADER(biSize=ctypes.sizeof(BITMAPINFOHEADER), biWidth=px, biHeight=-px,
                               biPlanes=1, biBitCount=32, biCompression=0)
        self._bits = ctypes.c_void_p()
        dib = gdi.CreateDIBSection(self._mem_dc, ctypes.byref(bmi), 0, ctypes.byref(self._bits), None, 0)
        gdi.SelectObject(self._mem_dc, dib)
        u32.SetTimer(self.hwnd, TIMER_FRAME, int(1000 / FPS), None)
        self._ready.set()
        msg = wintypes.MSG()
        while u32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            u32.DispatchMessageW(ctypes.byref(msg))

    def _paint(self):
        lerp = lambda a, b, k: a + (b - a) * k  # noqa: E731
        self.in_s = lerp(self.in_s, self.in_level, 0.25)
        self.out_s = lerp(self.out_s, self.out_level, 0.25)
        self.in_level *= 0.92
        self.out_level *= 0.92
        energy = self.in_s if self.status == "listening" else self.out_s if self.status == "speaking" else 0.0
        target = PALETTES[self.status]
        for i in range(4):
            for k in range(3):
                self.palette[i][k] = lerp(self.palette[i][k], target[i][k], 0.06)
        data = self.renderer.frame(time.monotonic() - self._t0, self.palette, self.status, self.running,
                                   min(energy, 1.0), self.hover)
        ctypes.memmove(self._bits, data, len(data))
        px = self.renderer.px
        blend = BLENDFUNCTION(AC_SRC_OVER, 0, 255, AC_SRC_ALPHA)
        u32.UpdateLayeredWindow(self.hwnd, self._screen_dc, None, ctypes.byref(wintypes.SIZE(px, px)),
                                self._mem_dc, ctypes.byref(wintypes.POINT(0, 0)), 0, ctypes.byref(blend),
                                ULW_ALPHA)

    def _proc(self, hwnd, msg, wparam, lparam):
        if msg == WM_TIMER and wparam == TIMER_FRAME:
            if self.visible:
                self._paint()
            return 0
        if msg == WM_TIMER and wparam == TIMER_CLICK:  # clique simples confirmado (nao virou duplo)
            u32.KillTimer(hwnd, TIMER_CLICK)
            self._toggle_live()
            return 0
        if msg == MSG_SHOW:
            self.visible = True
            self._paint()
            u32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
            return 0
        if msg == MSG_HIDE:
            self.visible = False
            u32.ShowWindow(hwnd, SW_HIDE)
            return 0
        if msg == MSG_QUIT:
            u32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            u32.PostQuitMessage(0)
            return 0
        if msg == WM_MOUSEACTIVATE:
            return MA_NOACTIVATE  # clicar no orb nao rouba o foco da janela em que o usuario esta
        if msg == WM_MOUSEMOVE:
            if not self.hover:
                self.hover = True
                tme = TRACKMOUSEEVENT(ctypes.sizeof(TRACKMOUSEEVENT), TME_LEAVE, hwnd, 0)
                u32.TrackMouseEvent(ctypes.byref(tme))
            if self._drag:
                cur = wintypes.POINT()
                u32.GetCursorPos(ctypes.byref(cur))
                (c0x, c0y), (w0x, w0y), moved = self._drag
                dx, dy = cur.x - c0x, cur.y - c0y
                if moved or math.hypot(dx, dy) > 4:
                    self._drag = ((c0x, c0y), (w0x, w0y), True)
                    u32.SetWindowPos(hwnd, None, w0x + dx, w0y + dy, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
            return 0
        if msg == WM_MOUSELEAVE:
            self.hover = False
            return 0
        if msg == WM_LBUTTONDOWN:
            cur, rect = wintypes.POINT(), wintypes.RECT()
            u32.GetCursorPos(ctypes.byref(cur))
            u32.GetWindowRect(hwnd, ctypes.byref(rect))
            self._drag = ((cur.x, cur.y), (rect.left, rect.top), False)
            u32.SetCapture(hwnd)
            return 0
        if msg == WM_LBUTTONUP:
            u32.ReleaseCapture()
            moved = bool(self._drag and self._drag[2])
            self._drag = None
            if moved or self._after_dbl:
                self._after_dbl = False
                return 0
            x, y = _xy(lparam)
            rd = self.renderer
            if self.hover and rd.hit(x, y, rd.expand_c):
                self.on_expand()
            elif self.hover and self.running and rd.hit(x, y, rd.pause_c):
                self._post("/api/live/resume" if self.status == "paused" else "/api/live/pause")
            else:  # espera o tempo do duplo clique antes de decidir
                u32.SetTimer(hwnd, TIMER_CLICK, u32.GetDoubleClickTime(), None)
            return 0
        if msg == WM_LBUTTONDBLCLK:
            u32.KillTimer(hwnd, TIMER_CLICK)
            self._after_dbl = True
            self.on_expand()
            return 0
        return u32.DefWindowProcW(hwnd, msg, wparam, lparam)
