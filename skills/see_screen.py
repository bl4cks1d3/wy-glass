SCHEMA = {
    "type": "function",
    "function": {
        "name": "see_screen",
        "description": (
            "Tira um print da tela do usuario e DESCREVE em voz o que esta sendo visto (nao "
            "salva arquivo nenhum). Use quando o usuario pedir pra ver/olhar/visualizar a "
            "tela dele, ou perguntar o que tem na tela — nao quando ele pedir pra 'tirar um "
            "print'/'salvar um print' (isso e take_screenshot)."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    # describe_screen fica em smart_agent.py (usa o modelo de visao da Groq) — repassado via
    # ctx pra esta skill nao precisar importar smart_agent de volta (evitaria ciclo de import).
    describe_screen = ctx["describe_screen"]
    return describe_screen(ctx.get("groq_api_key", "")), True
