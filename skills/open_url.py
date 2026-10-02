SCHEMA = {
    "type": "function",
    "function": {
        "name": "open_url",
        "description": "Abre uma URL/site especifico no navegador padrao do usuario.",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "URL completa a abrir"}},
            "required": ["url"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import browser_tools
    url = args.get("url", "")
    browser_tools.open_url(url)
    return f"Aberto: {url}", True
