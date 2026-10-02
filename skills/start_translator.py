SCHEMA = {
    "type": "function",
    "function": {
        "name": "start_translator",
        "description": (
            "Ativa o modo tradutor: grava a proxima fala em qualquer idioma e fala a "
            "traducao em voz alta (portugues<->ingles — a direcao e detectada sozinha, nao "
            "precisa perguntar qual). Use quando o usuario pedir pra traduzir algo, iniciar "
            "traducao, ou ativar o modo tradutor/interprete."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import actions
    # translator_agent ja fala a traducao sozinho (na voz do idioma certo) antes de retornar —
    # process_turn nao fala de novo em cima disso (ver "already_spoken" especial pra essa
    # ferramenta em process_turn).
    return actions.translator_agent({
        "groq_api_key": ctx.get("groq_api_key", ""),
        "omni_route": ctx.get("omni_route"),
    }), True
