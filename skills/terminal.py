SCHEMA = {
    "type": "function",
    "function": {
        "name": "terminal",
        "description": (
            "Terminal por voz com o Claude Code (assinatura do usuario): navega nas pastas do computador "
            "e conversa com o Claude Code na pasta atual pra construir, corrigir, explicar ou rodar "
            "coisas. acao=onde (pasta atual), listar (o que tem na pasta), entrar (destino = nome da "
            "pasta como ele falou, 'voltar' sobe uma, 'inicio' volta pros projetos), pedir (texto = o "
            "pedido pro Claude Code, com as palavras dele; continua a conversa daquela pasta), status "
            "(o que esta fazendo), parar, nova_conversa, mostrar (abre o painel). O pedir roda em "
            "segundo plano: diga que mandou e que avisa quando terminar; nao invente o resultado."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "acao": {"type": "string",
                         "enum": ["onde", "listar", "entrar", "pedir", "status", "parar", "nova_conversa", "mostrar"]},
                "destino": {"type": "string", "description": "pasta pra entrar (acao=entrar)"},
                "texto": {"type": "string", "description": "pedido pro Claude Code (acao=pedir)"},
            },
            "required": ["acao"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import voice_terminal as vt
    acao = args.get("acao", "onde")
    if acao in ("pedir", "entrar", "mostrar", "listar"):
        vt._emit({"type": "terminal_open"})  # o painel Terminal aparece (flutuante, se ele estiver em outro app)
    if acao == "onde":
        return f"Pasta atual: {vt.cwd()}", True
    if acao == "listar":
        return vt.listing(), True
    if acao == "entrar":
        return vt.change_dir(args.get("destino", "")), True
    if acao == "pedir":
        texto = (args.get("texto") or "").strip()
        if not texto:
            return "Diga o que o Claude Code deve fazer.", False
        return vt.ask(texto), True
    if acao == "status":
        s = vt.snapshot(8)
        if s["busy"]:
            last = next((e["text"] for e in reversed(s["entries"]) if e["kind"] in ("tool", "assistant")), "")
            return f"Trabalhando em {s['name']}: {s['task']}. Ultimo passo: {last[:200]}", True
        return f"Parado em {s['name']}.", True
    if acao == "parar":
        return vt.stop(), True
    if acao == "nova_conversa":
        return vt.new_session(), True
    return "Painel do terminal aberto.", True
