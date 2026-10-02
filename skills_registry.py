"""
skills_registry.py — registro pluggavel de ferramentas do harness do Wy Glass.

Antes (smart_agent.py v1): uma lista TOOLS fixa + uma cadeia if/elif em execute_tool(). Pra
adicionar uma ferramenta nova, editava os dois lugares no mesmo arquivo.

Agora: cada ferramenta e um arquivo em skills/, com dois nomes exportados —
    SCHEMA: dict no formato OpenAI tools ({"type": "function", "function": {...}})
    execute(args: dict, ctx: dict) -> tuple[str, bool]  (mesmo contrato de antes: resultado,
        skip_summary)
Esse modulo descobre todo arquivo em skills/*.py automaticamente (sem precisar registrar em
lugar nenhum) e expõe as mesmas duas operacoes que o resto do codigo (smart_agent.py) usa:
get_all_tools() e execute_tool(name, args, ctx).

Ferramentas de servidores MCP conectados (ver mcp_client.py) sao misturadas automaticamente
aqui tambem, com o nome prefixado "mcp__<servidor>__" — do ponto de vista de quem chama
get_all_tools()/execute_tool(), uma ferramenta MCP e indistinguivel de uma skill local.
"""
import importlib
import json as _json
import pkgutil
import re
from pathlib import Path

SKILLS_DIR = Path(__file__).parent / "skills"
_GENERATED_MARKER = "# __wyglass_skill_creator_generated__"
_VALID_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,49}$")

# Toda skill gerada pelo formulario delega pra uma dessas acoes ja existentes e vetadas em
# actions.py -- o criador de skills nunca executa codigo Python arbitrario escrito pelo
# usuario, so preenche um template fixo com os dados do formulario.
_ACTION_TYPES = ("run_command", "open_url", "key_shortcut", "screenshot")

_skills: dict[str, dict] = {}  # nome da ferramenta -> {"schema": ..., "execute": fn, "module": "skills.xxx"}


def _load_local_skills():
    global _skills
    loaded = {}
    for _finder, mod_name, is_pkg in pkgutil.iter_modules([str(SKILLS_DIR)]):
        if is_pkg or mod_name.startswith("_"):
            continue
        full_name = f"skills.{mod_name}"
        try:
            module = importlib.import_module(full_name)
            module = importlib.reload(module)  # pega reload() pegar mudancas sem reiniciar o processo
        except Exception as e:
            print(f"[skills_registry] falha ao carregar '{full_name}': {e}", flush=True)
            continue
        schema = getattr(module, "SCHEMA", None)
        execute_fn = getattr(module, "execute", None)
        if not schema or not execute_fn:
            print(f"[skills_registry] '{full_name}' nao exporta SCHEMA/execute — ignorado", flush=True)
            continue
        tool_name = schema.get("function", {}).get("name")
        if not tool_name:
            print(f"[skills_registry] '{full_name}' tem SCHEMA sem function.name — ignorado", flush=True)
            continue
        loaded[tool_name] = {"schema": schema, "execute": execute_fn, "module": full_name}
    _skills = loaded
    print(f"[skills_registry] {len(_skills)} skill(s) local(is) carregada(s): {', '.join(_skills)}", flush=True)


def reload():
    """Recarrega skills locais do disco (novo arquivo em skills/, edicao numa skill existente)
    sem precisar reiniciar o server.py inteiro. Chamado pelo painel/CLI quando quiser."""
    _load_local_skills()


def get_all_tools(allowed: list[str] | None = None) -> list[dict]:
    """Devolve o schema de todas as ferramentas disponiveis (skills locais + MCP), no formato
    que vai direto no campo "tools" da chamada ao LLM. `allowed`, se dado, filtra pra so essas
    ferramentas (usado pelos perfis de agente — ver smart_agent.AGENT_PROFILES)."""
    tools = [s["schema"] for s in _skills.values()]
    try:
        import mcp_client
        tools += mcp_client.get_all_tool_schemas()
    except Exception as e:
        print(f"[skills_registry] mcp_client indisponivel: {e}", flush=True)
    if allowed is not None:
        tools = [t for t in tools if t["function"]["name"] in allowed]
    return tools


def is_generated(name: str) -> bool:
    """True se a skill foi criada pelo formulario da aba FERRAMENTAS (ver create_skill) —
    usado pelo dashboard pra so oferecer o botao de apagar nessas, nunca nas escritas a mao."""
    path = SKILLS_DIR / f"{name}.py"
    if not path.exists():
        return False
    return _GENERATED_MARKER in path.read_text(encoding="utf-8")


def execute_tool(name: str, args: dict, ctx: dict) -> tuple[str, bool]:
    if name.startswith("mcp__"):
        import mcp_client
        return mcp_client.call_tool(name, args)
    skill = _skills.get(name)
    if skill is None:
        return f"ferramenta desconhecida: {name}", False
    return skill["execute"](args, ctx)


def create_skill(name: str, description: str, action_type: str, static_params: dict,
                  model_params: list[dict]) -> str:
    """Gera skills/<name>.py a partir do formulario da aba FERRAMENTAS — delega pra uma acao ja
    existente (_ACTION_TYPES), sem executar nenhum codigo escrito pelo usuario. Retorna o nome
    do arquivo criado. Levanta ValueError com uma mensagem legivel se algo for invalido."""
    name = (name or "").strip()
    if not _VALID_NAME_RE.match(name):
        raise ValueError("nome invalido — use letras minusculas, numeros e _ (3-50 caracteres, comecando com letra)")
    if name in _skills:
        raise ValueError(f"ja existe uma skill chamada '{name}'")
    if action_type not in _ACTION_TYPES:
        raise ValueError(f"tipo de acao desconhecido: {action_type} (use um de: {', '.join(_ACTION_TYPES)})")
    description = (description or "").strip()
    if not description:
        raise ValueError("descricao nao pode ficar vazia — e o que o modelo usa pra saber quando chamar essa skill")

    properties = {}
    required = []
    for p in model_params or []:
        pname = (p.get("name") or "").strip()
        if not pname or not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", pname):
            raise ValueError(f"nome de parametro invalido: {pname!r}")
        properties[pname] = {"type": "string", "description": p.get("description", "")}
        required.append(pname)

    schema = {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }

    content = f'''{_GENERATED_MARKER}
"""Gerada pelo criador de skills do dashboard (aba FERRAMENTAS). Editar manualmente e seguro,
mas sera SOBRESCRITA se voce recriar uma skill com o mesmo nome pelo formulario."""

SCHEMA = {_json.dumps(schema, ensure_ascii=False, indent=4)}

_ACTION_TYPE = {action_type!r}
_STATIC_PARAMS = {_json.dumps(static_params or {}, ensure_ascii=False, indent=4)}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    import actions
    params = dict(_STATIC_PARAMS)
    for key, value in params.items():
        if isinstance(value, str):
            try:
                params[key] = value.format(**args)
            except (KeyError, IndexError):
                pass  # placeholder nao bate com nenhum arg recebido -- mantem o valor original
    result = actions.run_action(_ACTION_TYPE, params)
    return result, True
'''
    path = SKILLS_DIR / f"{name}.py"
    path.write_text(content, encoding="utf-8")
    _load_local_skills()
    return path.name


def delete_skill(name: str):
    """So permite apagar skills geradas pelo criador (marcadas com _GENERATED_MARKER) -- skills
    escritas a mao (search.py, open_url.py, etc) nunca podem ser apagadas por aqui, so no disco
    diretamente. Protege contra apagar sem querer uma skill "de verdade" pelo dashboard."""
    path = SKILLS_DIR / f"{name}.py"
    if not path.exists():
        raise ValueError(f"skill '{name}' nao encontrada")
    content = path.read_text(encoding="utf-8")
    if _GENERATED_MARKER not in content:
        raise ValueError(f"'{name}' nao foi criada pelo formulario — apague o arquivo manualmente se tiver certeza")
    path.unlink()
    _load_local_skills()


_load_local_skills()
