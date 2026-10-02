SCHEMA = {
    "type": "function",
    "function": {
        "name": "end_conversation",
        "description": (
            "Encerra a conversa continua atual (modo conversa por clique duplo). Use "
            "SOMENTE quando o usuario se despedir claramente (tchau, ate mais, falou, pode "
            "desligar, e so isso mesmo, obrigado/valeu como despedida final) ou pedir "
            "explicitamente pra parar/encerrar a conversa. NUNCA use em resposta a uma "
            "pergunta ou pedido normal."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    return "Até mais!", True
