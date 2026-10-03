"""
mcp_client.py — cliente MCP (Model Context Protocol) pro harness do Wy Glass.

Servidores MCP rodam como processos separados (stdio) e o protocolo em si e assincrono
(JSON-RPC sobre stdio, SDK oficial `mcp`). O resto do projeto (smart_agent.py, skills/) e
sincrono de proposito (chamado via run_in_executor do event loop do server.py, mesma razao
documentada em audio_capture.py/passive_listener.py pra sounddevice) — entao este modulo
mantem seu PROPRIO event loop asyncio, numa thread dedicada, dona de todas as sessoes MCP
conectadas, e expoe uma API sincrona (connect_configured_servers/get_all_tool_schemas/
call_tool) que o resto do codigo sincrono chama sem se preocupar com asyncio.
"""
import asyncio
import threading

_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_sessions: dict[str, object] = {}       # nome do servidor -> ClientSession conectada
_server_cms: dict[str, object] = {}     # nome do servidor -> context manager stdio (pro shutdown)
_server_tools: dict[str, list[dict]] = {}  # nome do servidor -> [{"name", "description", "inputSchema"}]
_server_all: dict[str, list[str]] = {}    # nome do servidor -> nomes de todas as tools (antes do filtro)
_server_hidden: dict[str, list[dict]] = {} # tools fora da allowlist da voz -- so agentes as recebem
_errors: dict[str, str] = {}               # nome do servidor -> ultimo erro de conexao
_lock = threading.Lock()


def _ensure_loop():
    global _loop, _thread
    with _lock:
        if _loop is not None:
            return
        ready = threading.Event()

        def _run():
            global _loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            _loop = loop
            ready.set()
            loop.run_forever()

        _thread = threading.Thread(target=_run, daemon=True, name="mcp_client_loop")
        _thread.start()
        ready.wait(timeout=5)


def _run_coro(coro, timeout: float = 30.0):
    _ensure_loop()
    future = asyncio.run_coroutine_threadsafe(coro, _loop)
    return future.result(timeout=timeout)


async def _connect_server(name: str, command: str, args: list, env: dict | None, cwd: str | None = None,
                           include: list[str] | None = None, exclude: list[str] | None = None):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(command=command, args=args or [], env=env, cwd=cwd or None)
    # Os context managers precisam ficar abertos alem desta funcao (a sessao sobrevive pro
    # resto da execucao do servidor) -- por isso __aenter__ manual em vez de "async with", com
    # o cm guardado em _server_cms pra fechar direito em disconnect_all().
    cm = stdio_client(params)
    read, write = await cm.__aenter__()
    session = ClientSession(read, write)
    await session.__aenter__()
    await session.initialize()

    tools_result = await session.list_tools()
    _sessions[name] = session
    _server_cms[name] = cm
    # include/exclude por servidor: o modelo de voz se perde com dezenas de schemas (o
    # current-brain sozinho expoe ~46) -- cada servidor declara so o que faz sentido por voz
    tools = [t for t in tools_result.tools
             if (not include or t.name in include) and t.name not in (exclude or [])]
    _server_all[name] = [t.name for t in tools_result.tools]
    # SDK mcp >= 2 renomeou Tool.inputSchema -> input_schema; aceita os dois
    def _entry(t):
        return {"name": t.name, "description": t.description or "",
                "inputSchema": getattr(t, "input_schema", None) or getattr(t, "inputSchema", None)
                               or {"type": "object", "properties": {}}}

    _server_tools[name] = [_entry(t) for t in tools]
    visible = {t.name for t in tools}
    # exclusoes nunca vao pra agente nenhum: os agentes de texto trabalham sem confirmar cada passo
    _server_hidden[name] = [_entry(t) for t in tools_result.tools
                            if t.name not in visible and not t.name.startswith("delete_")
                            and t.name not in (exclude or [])]
    _errors.pop(name, None)
    print(f"[mcp_client] conectado a '{name}': {len(_server_tools[name])} ferramenta(s) — "
          f"{', '.join(t['name'] for t in _server_tools[name])}", flush=True)


def connect_configured_servers(servers: list[dict]):
    """Conecta todos os servidores MCP habilitados em config.json > mcp_servers. Chamado uma vez
    no startup do server.py (nao bloqueia o event loop principal — roda no loop dedicado desta
    thread). Falha de um servidor nao impede os outros de conectar."""
    import brain_office
    for cfg in servers or []:
        if not cfg.get("enabled", True):
            continue
        cfg = brain_office.expand(cfg)  # {office} -> raiz do monorepo
        name = cfg.get("name")
        command = cfg.get("command")
        if not name or not command:
            print(f"[mcp_client] entrada invalida em mcp_servers (falta 'name' ou 'command'): {cfg}", flush=True)
            continue
        if name in _sessions:
            continue  # ja conectado (reconexao/reload)
        try:
            _run_coro(_connect_server(name, command, cfg.get("args", []), cfg.get("env"), cfg.get("cwd"),
                                      cfg.get("tools"), cfg.get("exclude_tools")),
                      timeout=float(cfg.get("connect_timeout", 30.0)))
        except Exception as e:
            _errors[name] = (str(e) or type(e).__name__)[:300]
            print(f"[mcp_client] falha ao conectar '{name}': {e!r}", flush=True)


def get_all_tool_schemas(include_hidden: bool = False) -> list[dict]:
    """Ferramentas de todos os servidores MCP conectados, no formato OpenAI tools (mesmo
    formato dos skills locais — ver skills_registry.get_all_tools()). Nome prefixado
    mcp__<servidor>__<ferramenta> pra nao colidir com skills locais nem entre servidores.

    include_hidden: inclui as tools fora da allowlist da voz (config.json > mcp_servers[].tools),
    menos as de exclusao -- usado pelo agente Cerebro, que trabalha com o conjunto completo."""
    out = []
    for server_name, tools in _server_tools.items():
        for t in tools + (_server_hidden.get(server_name, []) if include_hidden else []):
            out.append({
                "type": "function",
                "function": {
                    "name": f"mcp__{server_name}__{t['name']}",
                    "description": t["description"],
                    "parameters": t["inputSchema"],
                },
            })
    return out


async def _call_tool(server_name: str, tool_name: str, args: dict) -> str:
    session = _sessions.get(server_name)
    if session is None:
        raise RuntimeError(f"servidor MCP '{server_name}' nao conectado")
    result = await session.call_tool(tool_name, args)
    parts = [c.text for c in result.content if hasattr(c, "text")]
    return "\n".join(parts) if parts else "(sem resultado)"


def call_tool(full_name: str, args: dict) -> tuple[str, bool]:
    """full_name no formato mcp__<servidor>__<ferramenta> (ver get_all_tool_schemas)."""
    try:
        _, server_name, tool_name = full_name.split("__", 2)
    except ValueError:
        return f"nome de ferramenta MCP invalido: {full_name}", False
    try:
        result = _run_coro(_call_tool(server_name, tool_name, args), timeout=30.0)
        return result, False
    except Exception as e:
        return f"erro na ferramenta MCP '{full_name}': {e}", False


async def _disconnect_all():
    for name, session in list(_sessions.items()):
        try:
            await session.__aexit__(None, None, None)
        except Exception:
            pass
    for name, cm in list(_server_cms.items()):
        try:
            await cm.__aexit__(None, None, None)
        except Exception:
            pass
    _sessions.clear()
    _server_cms.clear()
    _server_tools.clear()


def status(servers: list[dict]) -> list[dict]:
    """Estado de cada servidor de config.json > mcp_servers, pro painel do orb."""
    out = []
    for cfg in servers or []:
        name = cfg.get("name", "")
        out.append({
            "name": name,
            "description": cfg.get("description", ""),
            "enabled": cfg.get("enabled", True),
            "connected": name in _sessions,
            "tools": [t["name"] for t in _server_tools.get(name, [])],
            "all_tools": _server_all.get(name, []),
            "error": _errors.get(name),
        })
    return out


async def _disconnect_one(name: str):
    session = _sessions.pop(name, None)
    cm = _server_cms.pop(name, None)
    _server_tools.pop(name, None)
    for obj in (session, cm):
        if obj is None:
            continue
        try:
            await obj.__aexit__(None, None, None)
        except BaseException:
            pass  # anyio reclama de cancel scope saindo em outra task -- o subprocesso morre igual


def reconnect(servers: list[dict]):
    """Derruba e reconecta todos os servidores (ex.: depois de editar mcp_servers no painel).
    Desabilitados ficam desconectados."""
    _ensure_loop()
    for name in list(_sessions):
        try:
            _run_coro(_disconnect_one(name), timeout=10.0)
        except Exception:
            pass
    _errors.clear()
    connect_configured_servers(servers)


def disconnect_all():
    """Chamado no shutdown do server.py — fecha os subprocessos dos servidores MCP direito
    em vez de deixa-los orfaos."""
    if _loop is None:
        return
    try:
        _run_coro(_disconnect_all(), timeout=10.0)
    except Exception as e:
        print(f"[mcp_client] erro ao desconectar servidores MCP: {e}", flush=True)
