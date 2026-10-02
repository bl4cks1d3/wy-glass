SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_keyboard",
        "description": (
            "Teclado e area de transferencia do PC: digitar um texto onde o cursor estiver (type), "
            "apertar um atalho/tecla (hotkey, ex: 'ctrl+c', 'alt+tab', 'enter', 'ctrl+shift+t', "
            "'win+v'), ler o que esta copiado (clipboard_read) ou copiar um texto (clipboard_write). "
            "Para mandar uma mensagem, digite com enter=true."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["type", "hotkey", "clipboard_read", "clipboard_write"]},
                "text": {"type": "string", "description": "texto a digitar/copiar, ou a combinacao de teclas em hotkey"},
                "enter": {"type": "boolean", "description": "apertar Enter depois de digitar"},
                "times": {"type": "integer", "description": "quantas vezes repetir o atalho (default 1)"},
            },
            "required": ["action"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    action, text = args.get("action"), args.get("text", "")
    if action == "type":
        return pc_control.type_text(text, bool(args.get("enter"))), True
    if action == "hotkey":
        return pc_control.hotkey(text, args.get("times", 1)), True
    if action == "clipboard_read":
        return pc_control.clipboard_read(), False
    if action == "clipboard_write":
        return pc_control.clipboard_write(text), True
    return f"acao desconhecida: {action}", True
