SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_news",
        "description": "Busca noticias atuais do mundo. Use se o usuario pedir noticias/o que esta acontecendo.",
        "parameters": {"type": "object", "properties": {}},
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import browser_tools
    return browser_tools.fetch_news(), False
