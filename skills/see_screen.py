SCHEMA = {
    "type": "function",
    "function": {
        "name": "see_screen",
        "description": (
            "Olha a tela do usuario (print na hora, nada e salvo) e responde: sem pergunta, descreve "
            "o que esta aberto; com pergunta, responde sobre a tela ('o que diz esse e-mail?', 'qual "
            "o preco?', 'onde fica o botao de enviar?'). Use quando ele pedir pra ver/olhar a tela ou "
            "antes de agir numa tela que voce nao conhece -- nao quando pedir pra 'tirar/salvar um "
            "print' (isso e take_screenshot)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "pergunta": {"type": "string", "description": "o que procurar ou responder sobre a tela (opcional)"},
            },
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    # visao do Gemini (a mesma do pc_click): o modelo de visao da Groq usado antes saiu do ar (404)
    import pc_control
    from skills.pc_click import _google_key
    return pc_control.describe(args.get("pergunta", ""), _google_key(ctx), ctx.get("vision_model")), True
