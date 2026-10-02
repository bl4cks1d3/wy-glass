SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_apps",
        "description": (
            "Controla programas no PC do usuario: abrir um app (Chrome, Spotify, VS Code, "
            "WhatsApp, calculadora, configuracoes, qualquer app instalado), fechar a janela de um "
            "app, trazer um app pra frente, ou listar as janelas abertas. Fechar so manda fechar a "
            "janela (o app pode pedir pra salvar), nunca mata processo."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["open", "close", "focus", "list"]},
                "name": {"type": "string", "description": "nome do app ou parte do titulo da janela (vazio em list)"},
            },
            "required": ["action"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    action, name = args.get("action"), args.get("name", "")
    if action == "list":
        return pc_control.list_windows(), False
    if not name:
        return "diga qual app", True
    fn = {"open": pc_control.open_app, "close": pc_control.close_app, "focus": pc_control.focus_app}.get(action)
    return (fn(name) if fn else f"acao desconhecida: {action}"), True
