"""
pc_control.py — controle do PC por voz (Windows). Logica compartilhada pelas skills pc_*.

As skills em skills/pc_*.py sao so o SCHEMA + uma chamada pra ca, pra manter o contrato do
skills_registry (um arquivo por ferramenta) sem espalhar a logica de Win32/visao por seis lugares.

Clique por descricao (click_on): print da tela -> Gemini localiza o elemento descrito (ponto
normalizado 0-1000, formato nativo de "pointing" do Gemini) -> converte pra pixels -> clica.
O processo inteiro precisa estar em DPI-aware pra print e mouse falarem o mesmo sistema de
coordenadas em telas com escala (125%/150%): pyautogui ja chama SetProcessDPIAware() no import,
por isso ele e importado antes de qualquer captura.
"""
import os
import re
import subprocess
import time
from pathlib import Path

# medido apontando elementos da barra de tarefas numa tela 1920x1200: 3.5-flash-lite sem raciocinio
# acerta no pixel em ~2-4s; os flash "pensantes" acertam igual mas levam 20-30s (inviavel por voz)
# e o 2.5-flash e rapido mas errou o relogio em ~130px
VISION_MODEL = "gemini-3.5-flash-lite"
VISION_FALLBACKS = ["gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"]

# apelido falado -> comando. O resto cai na busca por atalho no Menu Iniciar.
_APP_ALIASES = {
    "chrome": "chrome", "google chrome": "chrome", "navegador": "msedge", "edge": "msedge",
    "firefox": "firefox", "vscode": "code", "vs code": "code", "visual studio code": "code",
    "terminal": "wt", "prompt": "cmd", "powershell": "powershell", "explorador": "explorer",
    "explorador de arquivos": "explorer", "arquivos": "explorer", "bloco de notas": "notepad",
    "notepad": "notepad", "calculadora": "calc", "paint": "mspaint",
    "configuracoes": "ms-settings:", "configurações": "ms-settings:", "gerenciador de tarefas": "taskmgr",
    "spotify": "spotify:", "whatsapp": "whatsapp:", "discord": "discord:",
}
_START_MENU_DIRS = [
    Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "Microsoft/Windows/Start Menu/Programs",
    Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs",
]


def _norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.lower()).strip()


# ---------------------------------------------------------------- apps e janelas

def _visible_windows():
    import pygetwindow as gw
    return [w for w in gw.getAllWindows() if w.title.strip() and w.visible and w.width > 50 and w.height > 50]


def _find_window(query: str):
    q = _norm(query)
    if not q or q in ("atual", "ativa", "essa", "esta"):
        import pygetwindow as gw
        return gw.getActiveWindow()
    wins = _visible_windows()
    exact = [w for w in wins if _norm(w.title) == q]
    if exact:
        return exact[0]
    partial = [w for w in wins if q in _norm(w.title)]
    if partial:
        return partial[0]
    # por nome de processo (ex.: "spotify" quando o titulo e o nome da musica)
    try:
        import psutil
        import win32process  # noqa: F401 -- pywin32 vem com o pywinauto
        for w in wins:
            _, pid = win32process.GetWindowThreadProcessId(w._hWnd)
            if q in _norm(psutil.Process(pid).name()):
                return w
    except Exception:
        pass
    return None


def _start_menu_lookup(name: str) -> str | None:
    q = _norm(name)
    best = None
    for root in _START_MENU_DIRS:
        if not root.exists():
            continue
        for lnk in root.rglob("*.lnk"):
            stem = _norm(lnk.stem)
            if stem == q:
                return str(lnk)
            if q in stem and "uninstall" not in stem and "desinstalar" not in stem:
                if best is None or len(stem) < len(_norm(Path(best).stem)):
                    best = str(lnk)
    return best


def open_app(name: str) -> str:
    target = _APP_ALIASES.get(_norm(name)) or _start_menu_lookup(name)
    if not target:
        # ultimo recurso: deixa o shell do Windows resolver (apps do PATH, "App Paths" do registro)
        target = name
    try:
        os.startfile(target)
    except OSError:
        try:
            subprocess.Popen(["cmd", "/c", "start", "", target], creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception as e:
            return f"Nao encontrei o app '{name}' ({e})."
    return f"Abrindo {name}."


def close_app(name: str) -> str:
    win = _find_window(name)
    if win is None:
        return f"Nenhuma janela aberta parecida com '{name}'."
    title = win.title
    win.close()  # WM_CLOSE: o app pode perguntar se quer salvar -- nunca mata processo
    return f"Fechando {title}."


def focus_app(name: str) -> str:
    win = _find_window(name)
    if win is None:
        return f"Nenhuma janela aberta parecida com '{name}'."
    try:
        if win.isMinimized:
            win.restore()
        win.activate()
    except Exception:
        # Windows bloqueia SetForegroundWindow de processo em segundo plano; um Alt "destrava"
        import pyautogui
        pyautogui.press("alt")
        win.activate()
    return f"{win.title} em primeiro plano."


def list_windows() -> str:
    titles = [w.title for w in _visible_windows()]
    if not titles:
        return "Nenhuma janela visivel."
    return "Janelas abertas: " + "; ".join(titles[:25])


def window_action(action: str, target: str = "") -> str:
    import pyautogui
    if action == "show_desktop":
        pyautogui.hotkey("win", "d")
        return "Area de trabalho."
    win = _find_window(target)
    if win is None:
        return f"Nao achei a janela '{target}'."
    if action != "minimize":
        try:
            win.activate()
        except Exception:
            pass
    if action == "minimize":
        win.minimize()
    elif action == "maximize":
        win.maximize()
    elif action == "restore":
        win.restore()
    elif action == "close":
        win.close()
    elif action in ("snap_left", "snap_right"):
        time.sleep(0.15)
        pyautogui.hotkey("win", "left" if action == "snap_left" else "right")
    else:
        return f"acao de janela desconhecida: {action}"
    return f"{action} em {win.title}."


# ---------------------------------------------------------------- teclado e clipboard

def type_text(text: str, enter: bool = False) -> str:
    import keyboard
    # keyboard.write manda unicode direto (acentos ok), sem depender do layout do teclado
    keyboard.write(text, delay=0.005)
    if enter:
        keyboard.send("enter")
    return "Digitado."


def hotkey(keys: str, times: int = 1) -> str:
    import keyboard
    combo = _norm(keys).replace(" + ", "+").replace(" ", "+")
    combo = {"control": "ctrl"}.get(combo, combo).replace("control", "ctrl").replace("windows", "win")
    for _ in range(max(1, min(int(times or 1), 20))):
        keyboard.send(combo)
        time.sleep(0.05)
    return f"Atalho {combo}."


def clipboard_read() -> str:
    import pyperclip
    text = pyperclip.paste() or ""
    return f"Area de transferencia: {text[:1500]}" if text else "Area de transferencia vazia."


def clipboard_write(text: str) -> str:
    import pyperclip
    pyperclip.copy(text)
    return "Copiado pra area de transferencia."


# ---------------------------------------------------------------- midia e volume

def _volume_endpoint():
    from pycaw.pycaw import AudioUtilities
    return AudioUtilities.GetSpeakers().EndpointVolume


def media(action: str, percent: int | None = None) -> str:
    import keyboard
    keys = {"play_pause": "play/pause media", "next": "next track", "previous": "previous track", "stop": "stop media"}
    if action in keys:
        keyboard.send(keys[action])
        return "Feito."
    vol = _volume_endpoint()
    if action == "mute":
        vol.SetMute(1, None)
        return "Mudo."
    if action == "unmute":
        vol.SetMute(0, None)
        return "Som ligado."
    current = round(vol.GetMasterVolumeLevelScalar() * 100)
    if action == "get_volume":
        return f"Volume em {current}%."
    if action in ("volume_up", "volume_down"):
        step = int(percent or 10)
        percent = current + step if action == "volume_up" else current - step
    if action in ("set_volume", "volume_up", "volume_down"):
        p = max(0, min(100, int(percent if percent is not None else current)))
        vol.SetMute(0, None)
        vol.SetMasterVolumeLevelScalar(p / 100, None)
        return f"Volume em {p}%."
    return f"acao de midia desconhecida: {action}"


# ---------------------------------------------------------------- visao + mouse

def _screenshot():
    import pyautogui  # noqa: F401 -- DPI awareness antes da captura (ver docstring do modulo)
    import mss
    from PIL import Image
    with mss.mss() as sct:
        mon = sct.monitors[1]
        raw = sct.grab(mon)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
    return img, mon


def _fast_thinking(model: str):
    """Menor raciocinio que cada familia aceita (2.5 usa budget; 3.x usa level, e so os -lite
    aceitam "minimal")."""
    from google.genai import types
    if "2.5" in model:
        return types.ThinkingConfig(thinking_budget=0)
    return types.ThinkingConfig(thinking_level="minimal" if "lite" in model else "low")


def locate(description: str, google_api_key: str, model: str | None = None) -> tuple[int, int] | None:
    """Pixel (x, y) do elemento descrito, ou None se o modelo nao achar."""
    import io
    import json
    from google import genai
    from google.genai import types

    img, mon = _screenshot()
    # imagem reduzida: o modelo devolve coordenada normalizada, entao resolucao menor so
    # economiza upload/latencia sem perder precisao relevante pra um clique
    small = img.copy()
    small.thumbnail((1600, 1600))
    buf = io.BytesIO()
    small.save(buf, format="JPEG", quality=85)
    prompt = (
        "Voce controla o mouse. Encontre na captura de tela o elemento descrito e responda SO com JSON "
        '{"found": true|false, "point": [y, x]} com o ponto central do elemento normalizado de 0 a 1000. '
        f"Elemento: {description}"
    )
    # sem retry longo do SDK: com o usuario esperando por voz, e melhor cair pro proximo modelo
    # (503 de sobrecarga no alias "latest" acontece) do que travar 60s+ no mesmo
    client = genai.Client(api_key=google_api_key,
                          http_options=types.HttpOptions(timeout=12_000, retry_options=types.HttpRetryOptions(attempts=1)))
    resp, last_err = None, None
    for m in dict.fromkeys([model or VISION_MODEL, *VISION_FALLBACKS]):
        try:
            resp = client.models.generate_content(
                model=m,
                contents=[types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"), prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0,
                                                   thinking_config=_fast_thinking(m)),
            )
            break
        except Exception as e:
            last_err = e
            print(f"[pc_control] visao falhou em {m}: {str(e)[:120]}", flush=True)
    if resp is None:
        raise RuntimeError(f"nenhum modelo de visao respondeu ({last_err})")
    try:
        data = json.loads(resp.text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not data.get("found") or not data.get("point"):
        return None
    y, x = data["point"][:2]
    return mon["left"] + round(x / 1000 * mon["width"]), mon["top"] + round(y / 1000 * mon["height"])


def click_on(description: str, google_api_key: str, button: str = "left", double: bool = False,
             model: str | None = None) -> str:
    import pyautogui
    pos = locate(description, google_api_key, model)
    if pos is None:
        return f"Nao encontrei '{description}' na tela."
    x, y = pos
    pyautogui.moveTo(x, y, duration=0.15)
    if double:
        pyautogui.doubleClick(x, y)
    else:
        pyautogui.click(x, y, button="right" if button == "right" else "left")
    return f"Cliquei em {description}."


def scroll(direction: str, amount: int = 5) -> str:
    import pyautogui
    clicks = max(1, min(int(amount or 5), 30)) * 120
    pyautogui.scroll(clicks if direction == "up" else -clicks)
    return "Rolado."


# ---------------------------------------------------------------- sistema

def system(action: str, confirmed: bool = False) -> str:
    if action == "lock":
        import ctypes
        ctypes.windll.user32.LockWorkStation()
        return "Tela bloqueada."
    if action == "status":
        import psutil
        bat = psutil.sensors_battery()
        bat_s = f", bateria {bat.percent:.0f}%{' carregando' if bat.power_plugged else ''}" if bat else ""
        mem = psutil.virtual_memory()
        return f"CPU em {psutil.cpu_percent(interval=0.4):.0f}%, memoria em {mem.percent:.0f}%{bat_s}."
    if action == "cancel_shutdown":
        subprocess.run(["shutdown", "/a"], capture_output=True)
        return "Desligamento cancelado."
    if action in ("shutdown", "restart", "sleep"):
        if not confirmed:
            return ("CONFIRMACAO NECESSARIA: pergunte ao usuario se ele confirma "
                    f"'{action}' e so chame de novo com confirmed=true se ele disser que sim.")
        if action == "sleep":
            subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
            return "Suspendendo."
        flag = "/s" if action == "shutdown" else "/r"
        # 30s de margem: da tempo de dizer "cancela" (cancel_shutdown)
        subprocess.run(["shutdown", flag, "/t", "30"], capture_output=True)
        return f"{'Desligando' if action == 'shutdown' else 'Reiniciando'} em 30 segundos. Diga 'cancela' pra abortar."
    return f"acao de sistema desconhecida: {action}"
