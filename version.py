"""
Fonte unica da versao do app — lida por server.py (exposta em /api/status), dashboard.py
(mostrada no cabecalho) e launchers/release.py (o bump de versao escreve aqui). Um arquivo de
texto simples em vez de uma constante em codigo Python pra que o release.py possa atualizar a
versao sem precisar editar/parsear source Python.
"""

from pathlib import Path

_VERSION_FILE = Path(__file__).parent / "VERSION"


def get_version() -> str:
    try:
        return _VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0-dev"
    except FileNotFoundError:
        return "0.0.0-dev"


__version__ = get_version()
