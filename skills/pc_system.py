SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_system",
        "description": (
            "Sistema do PC: bloquear a tela, status (CPU, memoria, bateria), suspender, desligar, "
            "reiniciar ou cancelar um desligamento. shutdown/restart/sleep seguem a regra de "
            "confirmacao do prompt (confirmed=true quando dispensada ou depois do sim). Desligar e "
            "reiniciar esperam 30 segundos (cancel_shutdown aborta)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["lock", "status", "sleep", "shutdown", "restart", "cancel_shutdown"]},
                "confirmed": {"type": "boolean", "description": "true depois do sim do usuario, ou direto se confirmacoes estiverem dispensadas"},
            },
            "required": ["action"],
        },
    },
}


def _confirmations_on() -> bool:
    import json
    from pathlib import Path
    try:
        cfg = json.loads((Path(__file__).parent.parent / "config.json").read_text(encoding="utf-8"))
        return cfg.get("live", {}).get("confirm_actions", True)
    except (OSError, ValueError):
        return True


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    confirmed = bool(args.get("confirmed")) or not _confirmations_on()
    return pc_control.system(args.get("action", ""), confirmed), False
