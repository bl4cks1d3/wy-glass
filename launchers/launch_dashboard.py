"""
Tiny launcher, meant to be frozen into WyGlassDashboard.exe by PyInstaller.
Only stdlib — dashboard.py itself already knows how to start server.py if it
isn't running yet (see dashboard.py:ensure_server_running), so this launcher
just needs to start dashboard.py with the real interpreter and get out of
the way. The .exe can live anywhere — the project path is hardcoded below.
"""

import subprocess
import sys
from pathlib import Path

# o Python que tem as dependencias do app (pywebview, vosk, google-genai...); o pythoncore-3.14-64
# tambem instalado nao tem o pywebview e o dashboard nao abria como janela. pythonw: sem console
PYTHON_EXE = r"C:\Users\bl4cks1d3\AppData\Local\Programs\Python\Python314\pythonw.exe"
# rodando como .py: a raiz do repo e a pasta acima de launchers/. Congelado em .exe (PyInstaller) o
# __file__ nao aponta pro repo, entao vale o caminho fixo. Antes era sempre fixo -- e apontava pra
# pasta antiga (claude/projects/cerebro-oculos), que abria o dashboard antigo.
BASE_DIR = (Path(r"C:\Users\bl4cks1d3\Documents\repo\wy-glass") if getattr(sys, "frozen", False)
            else Path(__file__).resolve().parent.parent)


def main():
    subprocess.Popen([PYTHON_EXE, str(BASE_DIR / "dashboard.py")], cwd=str(BASE_DIR))


if __name__ == "__main__":
    main()
