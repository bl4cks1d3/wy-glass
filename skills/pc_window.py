SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_window",
        "description": (
            "Organiza janelas no PC: minimizar, maximizar, restaurar, fechar, encaixar na metade "
            "esquerda/direita da tela, ou mostrar a area de trabalho. target vazio = janela ativa."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["minimize", "maximize", "restore", "close",
                                                       "snap_left", "snap_right", "show_desktop"]},
                "target": {"type": "string", "description": "titulo ou app da janela; vazio = ativa"},
            },
            "required": ["action"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    return pc_control.window_action(args.get("action", ""), args.get("target", "")), True
