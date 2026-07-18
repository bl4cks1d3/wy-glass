"""
Um clique pra rodar tudo, sem incomodar: valida o ambiente (mesmas checagens do setup_dev.py,
sem instalar nada), sobe o servidor se ainda nao estiver rodando (esperando de verdade a porta
abrir, nao so disparando o processo e torcendo), e abre o Dashboard — tudo isso rodando oculto
(pythonw.exe, sem janela de console nenhuma). Se algo falhar, aparece uma caixa de erro nativa
do Windows (MessageBoxW) com o motivo — nao fica muda feito WyGlass.exe/WyGlassDashboard.exe
(DETACHED_PROCESS, cuja falha some inteira dentro do server_launcher.log).

pythonw.exe deixa sys.stdout/stderr como None (nao so fechado) — qualquer print() nesse estado
derruba o processo com AttributeError (mesmo problema ja documentado no launch_server.py deste
projeto). Por isso o bloco logo abaixo redireciona stdout/stderr pra um arquivo de log sempre
que roda sem console, antes de qualquer outro print() no modulo.

Uso:
    python start_all.py                    # com console, se chamado direto (ex: debug)
    pythonw.exe start_all.py                # oculto — o que "Iniciar Wy Glass.vbs" faz
"""

import socket
import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).parent

if sys.stdout is None:
    _log = open(BASE_DIR / "start_all.log", "a", encoding="utf-8")
    sys.stdout = _log
    sys.stderr = _log

import setup_dev  # noqa: E402 (precisa vir depois do redirecionamento de stdout acima)

SERVER_PORT = 8731
STARTUP_TIMEOUT_SECONDS = 20
LOG_PATH = BASE_DIR / "server_launcher.log"

# python.exe (com console, mas o stdout do server.py e sempre redirecionado explicitamente pra
# um arquivo abaixo, entao console ou nao da na mesma) pro servidor; pythonw.exe (sem console)
# pro dashboard, que e uma janela Tkinter e nunca imprime nada — nao ha por que abrir um console
# fantasma atras dela.
_PYTHON_DIR = Path(sys.executable).parent
PYTHON_EXE = str(_PYTHON_DIR / "python.exe")
PYTHONW_EXE = str(_PYTHON_DIR / "pythonw.exe")


def _show_error_box(msg: str):
    """Caixa de erro nativa do Windows — funciona mesmo sem console (pythonw.exe) e mesmo se
    stdout estiver redirecionado pra um arquivo que ninguem vai olhar na hora."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, msg, "Wy Glass — erro ao iniciar", 0x10)
    except Exception:
        pass


def fail(msg: str):
    print(f"\n[ERRO] {msg}")
    _show_error_box(msg)
    sys.exit(1)


def port_open(port: int = SERVER_PORT, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def check_env():
    print("verificando ambiente...")
    problems = []
    if not setup_dev.check_python_version():
        problems.append(f"Python {'.'.join(map(str, setup_dev.MIN_PYTHON))}+ necessario")
    missing = setup_dev.check_packages()
    if missing:
        problems.append(f"pacotes faltando: {', '.join(missing)}")
    if not setup_dev.check_tts_model():
        problems.append("modelo de voz Piper ausente")
    if not setup_dev.check_config():
        problems.append("config.json ausente")
    if problems:
        fail("Ambiente incompleto:\n\n" + "\n".join(problems) + "\n\nRode: python setup_dev.py")
    print("[OK] ambiente completo")


def start_server():
    if port_open():
        print("[OK] servidor ja estava rodando")
        return
    print("subindo o servidor...")
    log_file = open(LOG_PATH, "a", encoding="utf-8")
    proc = subprocess.Popen(
        [PYTHON_EXE, str(BASE_DIR / "server.py")],
        cwd=str(BASE_DIR), stdout=log_file, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if port_open():
            print("[OK] servidor no ar")
            return
        if proc.poll() is not None:
            # morreu antes de abrir a porta — o motivo real esta no log
            tail = LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()[-20:]
            fail(f"server.py encerrou sozinho ao iniciar.\n\nUltimas linhas de {LOG_PATH.name}:\n\n"
                 + "\n".join(tail))
        time.sleep(0.5)
    fail(f"Servidor nao respondeu na porta {SERVER_PORT} em {STARTUP_TIMEOUT_SECONDS}s.\n\n"
         f"Veja {LOG_PATH}")


def start_dashboard():
    print("abrindo o dashboard...")
    dash_log_path = BASE_DIR / "dashboard_launcher.log"
    dash_log = open(dash_log_path, "a", encoding="utf-8")
    try:
        proc = subprocess.Popen(
            [PYTHONW_EXE, str(BASE_DIR / "dashboard.py")],
            cwd=str(BASE_DIR), stdout=dash_log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        )
    except Exception as e:
        fail(f"Nao consegui abrir o dashboard: {e}")
        return
    # da tempo da janela Tkinter subir (ou do processo morrer, se algo quebrar no import/init —
    # sem essa checagem, um crash aqui e completamente mudo: pythonw sem redirecionamento
    # nenhum, sem console, sem nada, foi exatamente o que aconteceu na primeira versao disso)
    time.sleep(1.5)
    if proc.poll() is not None:
        tail = dash_log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-20:]
        fail(f"dashboard.py encerrou sozinho ao abrir.\n\nUltimas linhas de {dash_log_path.name}:\n\n"
             + "\n".join(tail))
    print("[OK] dashboard aberto")


def main():
    print("=== Wy Glass — iniciando ===\n")
    check_env()
    start_server()
    start_dashboard()
    print("\nTudo pronto.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        fail(f"Erro inesperado: {e}")
