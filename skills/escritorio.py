"""Ponte com o Brain Office (ver brain_office.py): os agentes residentes de cada setor da vida,
lembretes, mural, aprovacoes e o retrato "Hoje" do escritorio."""

SCHEMA = {
    "type": "function",
    "function": {
        "name": "escritorio",
        "description": (
            "Brain Office, o escritorio de agentes residentes do usuario (um por setor: agenda, "
            "faculdade, pesquisa, projetos, clientes, pessoal, casa). Use pra: perguntar/pedir algo "
            "a um setor (perguntar; sem agent a recepcao escolhe o setor certo), ver status dos "
            "agentes, o painel Hoje (agenda Google, tarefas, provas, clientes, brief), o mural, "
            "lembretes (o personagem do setor avisa o usuario na hora) e pedidos de aprovacao dos "
            "agentes. Se o escritorio estiver desligado, use action=ligar (ele tambem sobe o "
            "Planner Core). Perguntar a um agente pode levar de 10s a 2min: avise o usuario antes. "
            "Aprovar/negar so depois do usuario dizer explicitamente."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": [
                    "status", "ligar", "perguntar", "ultima_resposta", "hoje", "mural",
                    "lembrete", "lembretes", "cancelar_lembrete", "pendencias", "aprovar", "negar", "brief"]},
                "text": {"type": "string", "description": "a pergunta/pedido (perguntar) ou o texto do lembrete"},
                "agent": {"type": "string", "description": "setor: agenda, faculdade, pesquisa, projetos, clientes, pessoal, casa (opcional em perguntar)"},
                "em_minutos": {"type": "number", "description": "lembrete daqui a N minutos"},
                "horario": {"type": "string", "description": "lembrete as HH:MM"},
                "a_cada_minutos": {"type": "number", "description": "lembrete repetido (minimo 5)"},
                "id": {"type": "string", "description": "id do lembrete ou do pedido de aprovacao"},
            },
            "required": ["action"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import brain_office as bo
    action = args.get("action", "status")
    if action == "ligar":
        return bo.start(), True
    if not bo.is_up():
        return ("O Brain Office esta desligado. Pergunte se o usuario quer ligar (escritorio action=ligar). "
                "Pra so ler os dados da vida sem ligar nada, use ler_dados_da_vida."), False
    try:
        if action == "status":
            return bo.status(), False
        if action == "perguntar":
            if not args.get("text"):
                return "diga o que perguntar", True
            return bo.ask(args["text"], args.get("agent") or None), False
        if action == "ultima_resposta":
            return bo.last_reply(args.get("agent") or "agenda"), False
        if action == "hoje":
            return bo.hoje(), False
        if action == "mural":
            return bo.board(), False
        if action == "lembrete":
            if not args.get("text"):
                return "diga o texto do lembrete", True
            return bo.add_reminder(args["text"], args.get("agent"), args.get("em_minutos"),
                                   args.get("horario"), args.get("a_cada_minutos")), True
        if action == "lembretes":
            return bo.reminders(), False
        if action == "cancelar_lembrete":
            return bo.cancel_reminder(args.get("id", "")), True
        if action == "pendencias":
            return bo.permissions(), False
        if action in ("aprovar", "negar"):
            return bo.resolve_permission(args.get("id", ""), action == "aprovar"), True
        if action == "brief":
            return bo.run_brief(), True
    except Exception as e:
        return f"Falha ao falar com o Brain Office: {e}", False
    return f"acao desconhecida: {action}", True
