SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_click",
        "description": (
            "Clica no elemento DESCRITO na tela (botao, link, icone, campo de texto, aba...), ex: "
            "'Enviar', 'campo de busca do YouTube', 'Spotify na barra de tarefas'. Acha pelo nome que o "
            "Windows da ao elemento (rapido e exato) e, se nao der, pela visao. action=listar devolve "
            "os nomes do que da pra clicar na janela em foco e na barra de tarefas: use antes de "
            "navegar numa janela desconhecida e passe o nome exato como target. Tambem rola a pagina "
            "(scroll). Para digitar num campo: clique nele e depois use pc_keyboard."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["click", "double_click", "right_click", "scroll_up", "scroll_down", "listar"]},
                "target": {"type": "string", "description": "descricao do elemento na tela (cliques)"},
                "amount": {"type": "integer", "description": "intensidade do scroll, 1-30 (default 5)"},
            },
            "required": ["action"],
        },
    },
}


def _google_key(ctx: dict) -> str:
    if ctx.get("google_api_key"):
        return ctx["google_api_key"]
    # fluxo classico (smart_agent) nao passa a chave do Gemini no ctx
    import json
    from pathlib import Path
    cfg = json.loads((Path(__file__).parent.parent / "config.json").read_text(encoding="utf-8"))
    return cfg.get("credentials", {}).get("google_api_key", "")


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import pc_control
    action = args.get("action", "click")
    if action == "listar":
        import ui_automation
        found = ui_automation.summary(ui_automation.elements())
        return found or "A janela em foco nao expoe os elementos; use see_screen pra olhar.", True
    if action in ("scroll_up", "scroll_down"):
        return pc_control.scroll(action.split("_")[1], args.get("amount", 5)), True
    target = args.get("target", "")
    if not target:
        return "diga onde clicar", True
    return pc_control.click_on(target, _google_key(ctx), button="right" if action == "right_click" else "left",
                               double=action == "double_click", model=ctx.get("vision_model")), True
