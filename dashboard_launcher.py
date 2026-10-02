"""
Launches/tracks the Tkinter dashboard (dashboard.py) as a separate process,
with a simple PID lock file so asking to "open the dashboard" twice doesn't
spawn two windows.
"""

import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
LOCK_FILE = BASE_DIR / ".dashboard.lock"


def _pid_alive(pid: int) -> bool:
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True, timeout=5,
        )
        return str(pid) in out.stdout
    except Exception:
        return False


def is_running() -> bool:
    if not LOCK_FILE.exists():
        return False
    try:
        pid = int(LOCK_FILE.read_text().strip())
    except (ValueError, OSError):
        return False
    return _pid_alive(pid)


def open_dashboard() -> str:
    if is_running():
        return "o dashboard ja esta aberto"
    proc = subprocess.Popen([sys.executable, str(BASE_DIR / "dashboard.py")], cwd=str(BASE_DIR))
    LOCK_FILE.write_text(str(proc.pid))
    return "dashboard aberto"


ORB_URL = "http://127.0.0.1:8731/orb"


def open_orb() -> str:
    """Abre a interface Live (/orb) como janela de app: Edge/Chrome em modo --app (sem barra de
    endereco/abas). Sem nenhum dos dois, cai pro navegador padrao."""
    import shutil
    import webbrowser
    candidates = [
        shutil.which("msedge"), shutil.which("chrome"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    ]
    exe = next((c for c in candidates if c and Path(c).is_file()), None)
    if exe:
        subprocess.Popen([exe, f"--app={ORB_URL}", "--window-size=520,860"])
    else:
        webbrowser.open(ORB_URL)
    return "interface live aberta"
