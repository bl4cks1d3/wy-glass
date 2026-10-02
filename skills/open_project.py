"""Abre a pasta do projeto Wy Glass num app especifico — equivalente a rodar `code .` ou
`explorer .` na raiz do projeto, so que disparado por voz."""
import subprocess
from pathlib import Path

PROJECT_DIR = str(Path(__file__).parent.parent.resolve())

_APPS = {
    "code": (["code", PROJECT_DIR], "VS Code"),
    "explorer": (["explorer", PROJECT_DIR], "Explorador de Arquivos"),
    "terminal": (["wt", "-d", PROJECT_DIR], "terminal"),
}

SCHEMA = {
    "type": "function",
    "function": {
        "name": "open_project",
        "description": (
            "Abre a pasta do projeto Wy Glass num app de desenvolvimento. Use quando o "
            "usuario pedir pra abrir o projeto, o codigo, a pasta do projeto, ou mencionar "
            "abrir no VS Code / explorador de arquivos / terminal — equivalente a rodar "
            "'code .' ou 'explorer .' na pasta do projeto."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "app": {
                    "type": "string",
                    "enum": list(_APPS.keys()),
                    "description": "code = VS Code; explorer = Explorador de Arquivos do Windows; terminal = Windows Terminal",
                },
            },
            "required": ["app"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    app = args.get("app", "code")
    entry = _APPS.get(app)
    if entry is None:
        return f"app desconhecido: {app} (use: {', '.join(_APPS)})", False
    cmd, label = entry
    try:
        subprocess.Popen(cmd, shell=False)
    except FileNotFoundError:
        return f"{label} nao encontrado no PATH — confira se esta instalado", False
    return f"Abrindo a pasta do projeto no {label}.", True
