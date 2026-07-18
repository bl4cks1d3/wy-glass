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
