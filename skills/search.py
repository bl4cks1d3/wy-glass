SCHEMA = {
    "type": "function",
    "function": {
        "name": "search",
        "description": (
            "Pesquisa na internet. Cobre busca geral E dados ao vivo especificos: "
            "clima/tempo/temperatura, cambio/cotacao de moeda (dolar, euro, etc), "
            "preco de criptomoeda (bitcoin, etc), proximos feriados. Use sempre que "
            "o usuario pedir pra pesquisar/buscar algo, ou perguntar um desses dados "
            "ao vivo (nao precisa da palavra 'pesquisa' pra isso — 'quanto ta o dolar' "
            "ja e um pedido de search)."
        ),
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "o que pesquisar"}},
            "required": ["query"],
        },
    },
}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import browser_tools
    result = browser_tools.search_and_read(args.get("query", ""), tavily_api_key=ctx.get("tavily_api_key", ""))
    if "error" not in result:
        if result.get("live_data"):
            return result.get("content", ""), True
        return f"Pagina: {result.get('title', '')}\nURL: {result.get('url', '')}\n\n{result.get('content', '')[:2000]}", False
    return f"Busca falhou: {result.get('error', '')}", False
