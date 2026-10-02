SCHEMA = {
    "type": "function",
    "function": {
        "name": "pc_click",
        "description": (
            "Mouse guiado por visao: olha a tela e clica no elemento DESCRITO (botao, link, icone, "
            "campo de texto, aba...), ex: 'botao azul Enviar', 'campo de busca do YouTube', 'icone "
            "do Spotify na barra de tarefas'. Tambem rola a pagina (scroll). Descreva o elemento com "
            "texto visivel e posicao quando ajudar. Para digitar num campo: clique nele e depois use "
            "pc_keyboard."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["click", "double_click", "right_click", "scroll_up", "scroll_down"]},
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
    if action in ("scroll_up", "scroll_down"):
        return pc_control.scroll(action.split("_")[1], args.get("amount", 5)), True
    target = args.get("target", "")
    if not target:
        return "diga onde clicar", True
    return pc_control.click_on(target, _google_key(ctx), button="right" if action == "right_click" else "left",
                               double=action == "double_click", model=ctx.get("vision_model")), True
