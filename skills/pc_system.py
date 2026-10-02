SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_system",
        "description": (
            "Sistema do PC: bloquear a tela, status (CPU, memoria, bateria), suspender, desligar, "
            "reiniciar ou cancelar um desligamento. shutdown/restart/sleep EXIGEM confirmacao: "
            "pergunte antes e so mande confirmed=true depois que o usuario disser sim. Desligar e "
            "reiniciar esperam 30 segundos (cancel_shutdown aborta)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["lock", "status", "sleep", "shutdown", "restart", "cancel_shutdown"]},
                "confirmed": {"type": "boolean", "description": "true so depois do sim explicito do usuario"},
            },
            "required": ["action"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    return pc_control.system(args.get("action", ""), bool(args.get("confirmed"))), False
