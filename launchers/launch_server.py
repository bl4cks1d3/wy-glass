"""
Tiny launcher, meant to be frozen into WyGlass.exe by PyInstaller.
Only imports stdlib — no bleak/fastapi/etc — so freezing it is trivial and
has zero packaging risk. It never runs the real app logic itself; it just
starts server.py with the real Python interpreter, so double-clicking the
.exe always launches whatever the current server.py source says (edit the
.py files, no rebuild ever needed). The .exe can live anywhere (Desktop,
Start Menu...) — the project path is hardcoded below, not derived from
where the .exe itself sits.
"""

import socket
import subprocess
from pathlib import Path

PYTHON_EXE = r"C:\Users\bl4cks1d3\AppData\Local\Python\pythoncore-3.14-64\python.exe"
BASE_DIR = Path(r"C:\Users\bl4cks1d3\Documents\repo\claude\projects\cerebro-oculos\wy-glass")


def port_open(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def main():
    if port_open(8731):
        return  # already running
    # DETACHED_PROCESS gives the child no console at all — without redirecting
    # stdout/stderr somewhere, server.py's own print() calls raise
    # AttributeError on a None stdout and the process dies almost instantly.
    log_path = BASE_DIR / "server_launcher.log"
    log_file = open(log_path, "a", encoding="utf-8")
    subprocess.Popen(
        [PYTHON_EXE, str(BASE_DIR / "server.py")],
        cwd=str(BASE_DIR),
        stdout=log_file, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )


if __name__ == "__main__":
    main()
