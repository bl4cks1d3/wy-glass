SCHEMA = {
    "type": "function",
    "function": {
        "name": "open_dashboard",
        "description": "Abre o painel de controle/configuracoes dos oculos (Dashboard).",
        "parameters": {"type": "object", "properties": {}},
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import dashboard_launcher
    return dashboard_launcher.open_dashboard(), True
