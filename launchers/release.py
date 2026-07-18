"""
Capsulador de versao do Wy Glass: atualiza o numero de versao (arquivo VERSION na raiz) e
recompila os dois executaveis-trampolim (WyGlass.exe / WyGlassDashboard.exe) com PyInstaller,
num so comando.

Por que recompilar os .exe a cada bump, se launch_server.py/launch_dashboard.py so chamam o
Python real com server.py/dashboard.py (ver docstring desses dois arquivos) e nunca embutem a
logica do app? Porque e barato (poucos segundos, sem dependencias pesadas nos launchers) e
garante que dist/ nunca fique com um binario esquecido de uma versao anterior. server.py e
dashboard.py continuam sendo editados livremente sem precisar rodar este script — ele so
importa quando a propria versao/numero precisa mudar (ex: fim de uma sessao de mudancas) ou
quando os launchers-trampolim em si mudaram.

Uso:
    python launchers/release.py                 # bump patch (0.1.0 -> 0.1.1) + build
    python launchers/release.py --minor          # bump minor (0.1.1 -> 0.2.0) + build
    python launchers/release.py --major           # bump major (0.2.0 -> 1.0.0) + build
    python launchers/release.py --set 1.2.3       # versao explicita + build
    python launchers/release.py --no-build         # so bump, sem recompilar os .exe
"""

import argparse
import subprocess
import sys
from pathlib import Path

LAUNCHERS_DIR = Path(__file__).parent
BASE_DIR = LAUNCHERS_DIR.parent
VERSION_FILE = BASE_DIR / "VERSION"
SPEC_DIR = LAUNCHERS_DIR / "spec"
DIST_DIR = BASE_DIR / "dist"
BUILD_DIR = LAUNCHERS_DIR / "build"


def read_version() -> tuple[int, int, int]:
    raw = VERSION_FILE.read_text(encoding="utf-8").strip() if VERSION_FILE.exists() else "0.0.0"
    major, minor, patch = (int(p) for p in raw.split("."))
    return major, minor, patch


def bump(major: int, minor: int, patch: int, part: str) -> str:
    if part == "major":
        major, minor, patch = major + 1, 0, 0
    elif part == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return f"{major}.{minor}.{patch}"


def write_version(version: str):
    VERSION_FILE.write_text(version + "\n", encoding="utf-8")


def run_pyinstaller(spec_name: str):
    print(f"-> compilando {spec_name}...")
    # Specs referenciam o launcher fonte como "..\\launch_*.py" (relativo a launchers/spec/),
    # entao o cwd tem que ser essa pasta pra resolver certo — mesma convencao com que os specs
    # ja foram gerados originalmente.
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", spec_name,
         "--distpath", str(DIST_DIR), "--workpath", str(BUILD_DIR), "--noconfirm"],
        cwd=str(SPEC_DIR), check=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Bump de versao + build dos executaveis Wy Glass")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--major", action="store_true", help="bump major (X.0.0)")
    group.add_argument("--minor", action="store_true", help="bump minor (0.X.0)")
    group.add_argument("--set", metavar="X.Y.Z", help="define a versao explicitamente")
    parser.add_argument("--no-build", action="store_true", help="so bumpa a versao, sem recompilar os .exe")
    args = parser.parse_args()

    if args.set:
        new_version = args.set
    else:
        part = "major" if args.major else "minor" if args.minor else "patch"
        new_version = bump(*read_version(), part)

    write_version(new_version)
    print(f"versao: {new_version}  (gravado em {VERSION_FILE})")

    if not args.no_build:
        run_pyinstaller("WyGlass.spec")
        run_pyinstaller("WyGlassDashboard.spec")
        print(f"builds prontos em {DIST_DIR} (WyGlass.exe, WyGlassDashboard.exe)")


if __name__ == "__main__":
    main()
