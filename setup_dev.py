"""
Bootstrap do ambiente dev do Wy Glass (lado PC): instala as dependencias Python
(requirements.txt), valida que cada uma importa de verdade (nao so que o pip disse
"Successfully installed" — ver docs/05-instalacao.md, ja aconteceu de pip e python apontarem
pra interpretadores diferentes na mesma maquina), baixa o modelo de voz Piper se ainda nao
existir, garante que exista um config.json (copiando de config.example.json na primeira vez),
e no final resume o que ainda precisa de acao manual.

So cobre o lado PC (server.py/dashboard.py). O app Android tem setup proprio — SDK, Gradle,
JDK, tudo documentado em docs/10-app-android.md §10.20 — nao e algo pra automatizar aqui, ja
que envolve escolher onde instalar ferramentas grandes (Android SDK) que podem ja existir na
maquina em caminhos variados.

Uso:
    python setup_dev.py            # instala o que faltar, valida, baixa modelo de voz
    python setup_dev.py --check    # so relata o status, nao instala/baixa nada
"""

import argparse
import importlib
import subprocess
import sys
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).parent
REQUIREMENTS_FILE = BASE_DIR / "requirements.txt"
TTS_DIR = BASE_DIR / "tts_models"
TTS_MODEL_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx"
MIN_PYTHON = (3, 10)

# nome do pacote pip -> nome do modulo importavel (nem sempre sao iguais)
PACKAGE_IMPORT_NAMES = {
    "bleak": "bleak",
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "websockets": "websockets",
    "python-multipart": "multipart",
    "sounddevice": "sounddevice",
    "numpy": "numpy",
    "pillow": "PIL",
    "keyboard": "keyboard",
    "requests": "requests",
    "beautifulsoup4": "bs4",
    "piper-tts": "piper",
    "playwright": "playwright",
    "pyinstaller": "PyInstaller",
    "pystray": "pystray",
}


def _header(text: str):
    print(f"\n--- {text} ---")


def check_python_version() -> bool:
    ok = sys.version_info >= MIN_PYTHON
    v = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"[{'OK' if ok else 'FALTA'}] Python {v} (minimo {'.'.join(map(str, MIN_PYTHON))})")
    return ok


def check_packages() -> list[str]:
    """Retorna os nomes pip dos pacotes que faltam (import falhou)."""
    missing = []
    for pkg_name, import_name in PACKAGE_IMPORT_NAMES.items():
        try:
            importlib.import_module(import_name)
            print(f"[OK]    {pkg_name}")
        except ImportError:
            print(f"[FALTA] {pkg_name}")
            missing.append(pkg_name)
    return missing


def install_missing_packages():
    subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)], check=True)


def ensure_playwright_browser() -> bool:
    try:
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        print("[OK]    playwright chromium")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[FALTA] playwright chromium — rode manualmente: playwright install chromium ({e})")
        return False


def check_tts_model() -> bool:
    model = TTS_DIR / "pt_BR-faber-medium.onnx"
    cfg = TTS_DIR / "pt_BR-faber-medium.onnx.json"
    ok = model.exists() and cfg.exists()
    print(f"[{'OK' if ok else 'FALTA'}] modelo de voz Piper ({TTS_DIR})")
    return ok


def ensure_tts_model():
    TTS_DIR.mkdir(exist_ok=True)
    for suffix in ("", ".json"):
        dest = TTS_DIR / f"pt_BR-faber-medium.onnx{suffix}"
        if dest.exists():
            continue
        print(f"baixando {dest.name}...")
        urllib.request.urlretrieve(TTS_MODEL_URL + suffix, dest)
    print(f"[OK]    modelo de voz Piper em {TTS_DIR}")


def check_config() -> bool:
    ok = (BASE_DIR / "config.json").exists()
    print(f"[{'OK' if ok else 'FALTA'}] config.json")
    return ok


def ensure_config():
    config_path = BASE_DIR / "config.json"
    example_path = BASE_DIR / "config.example.json"
    if config_path.exists():
        print("[OK]    config.json ja existe")
        return
    if not example_path.exists():
        print("[FALTA] config.example.json nao encontrado — nao da pra criar config.json sozinho")
        return
    config_path.write_text(example_path.read_text(encoding="utf-8"), encoding="utf-8")
    print("[CRIADO] config.json (copiado de config.example.json — falta preencher endereco BLE "
          "e chaves de API, ver docs/05-instalacao.md §5.4/5.5)")


def main():
    parser = argparse.ArgumentParser(description="Setup do ambiente dev do Wy Glass (lado PC)")
    parser.add_argument("--check", action="store_true", help="so relata o status, nao instala/baixa nada")
    args = parser.parse_args()

    _header("PYTHON")
    py_ok = check_python_version()

    _header("PACOTES")
    missing = check_packages()
    if missing and not args.check:
        install_missing_packages()
        _header("REVALIDANDO PACOTES")
        missing = check_packages()

    if not args.check:
        _header("PLAYWRIGHT (CHROMIUM)")
        ensure_playwright_browser()

        _header("MODELO DE VOZ (PIPER)")
        ensure_tts_model()

        _header("CONFIG.JSON")
        ensure_config()
    else:
        _header("MODELO DE VOZ (PIPER)")
        check_tts_model()
        _header("CONFIG.JSON")
        check_config()

    _header("RESUMO")
    if not py_ok:
        print(f"- Instale Python {'.'.join(map(str, MIN_PYTHON))}+ antes de continuar.")
    if missing:
        print(f"- Ainda faltam pacotes: {', '.join(missing)}"
              + ("" if args.check else " (tente rodar de novo, ou instale manualmente)"))
    else:
        print("- Todas as dependencias Python OK.")
    print("- Confira config.json (endereco BLE + chaves de API) — docs/05-instalacao.md §5.4/5.5")
    print("- Pareie os oculos como dispositivo de audio Bluetooth no Windows (Configuracoes > "
          "Bluetooth e dispositivos)")
    print("- Pra rodar: python server.py  (ou dashboard.py, que sobe o servidor sozinho se "
          "precisar — ver docs/12-guia-de-uso.md)")


if __name__ == "__main__":
    main()
