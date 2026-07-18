"""
Tiny launcher, meant to be frozen into WyGlassDashboard.exe by PyInstaller.
Only stdlib — dashboard.py itself already knows how to start server.py if it
isn't running yet (see dashboard.py:ensure_server_running), so this launcher
just needs to start dashboard.py with the real interpreter and get out of
the way. The .exe can live anywhere — the project path is hardcoded below.
"""

import subprocess
from pathlib import Path

PYTHON_EXE = r"C:\Users\bl4cks1d3\AppData\Local\Python\pythoncore-3.14-64\python.exe"
BASE_DIR = Path(r"C:\Users\bl4cks1d3\Documents\repo\claude\projects\cerebro-oculos\wy-glass")


def main():
    subprocess.Popen([PYTHON_EXE, str(BASE_DIR / "dashboard.py")], cwd=str(BASE_DIR))


if __name__ == "__main__":
    main()
