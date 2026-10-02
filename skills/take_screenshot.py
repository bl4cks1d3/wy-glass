SCHEMA = {
    "type": "function",
    "function": {
        "name": "take_screenshot",
        "description": (
            "Tira um print da tela e SALVA como arquivo, sem descrever o conteudo em voz. "
            "Use quando o usuario pedir explicitamente pra tirar/salvar/capturar um print ou "
            "screenshot da tela — nao quando ele pedir pra ver/descrever a tela (isso e "
            "see_screen)."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import actions
    actions.screenshot({})
    return "Print salvo.", True
