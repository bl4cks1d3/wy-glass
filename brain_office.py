"""
brain_office.py — ponte com o Brain Office (repo brain-agents): o escritorio de agentes residentes
(setor-agenda, setor-faculdade, setor-clientes...) que rodam no Claude Agent SDK.

Fala com a API REST que o proprio painel do escritorio usa (server/src/brain/routes.ts, prefixo
/api/brain). Autenticacao: header x-brain-token com o token persistido em
~/.pixel-agents/brain/token (o mesmo que o painel usa na rede local) -- chamada de 127.0.0.1 sem
Origin tambem passaria, mas o token deixa a ponte valida mesmo se o escritorio rodar em outra
maquina (config.json > brain_office.url).

Mensagens sao fire-and-forget no Brain Office (a resposta chega pelo SSE /events); aqui a ponte
espera de forma sincrona, consultando o chat do agente ate ele voltar a "ocioso".
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

PIXEL_DIR = Path.home() / ".pixel-agents"
DEFAULT_PORT = 3456  # npm run office (brain-agents/package.json)
REPLY_TIMEOUT = 150
POLL_SECONDS = 1.5


def _cfg() -> dict:
    try:
        cfg = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))
        return cfg.get("brain_office") or {}
    except (OSError, json.JSONDecodeError):
        return {}


def office_dir() -> Path:
    """Raiz do monorepo do Brain Office. O Wy Glass mora em <office>/services/wyglass, entao por
    padrao e so subir duas pastas; config.json > brain_office.repo_dir sobrescreve (ex.: rodar o
    oculos fora do monorepo)."""
    configured = _cfg().get("repo_dir")
    if configured:
        return Path(configured)
    here = Path(__file__).resolve().parent
    if here.parent.name == "services":
        return here.parent.parent
    return Path.home() / "Documents" / "repo" / "brain-agents"


def expand(value):
    """Troca {office} pelo caminho do monorepo em strings (e listas/dicts de strings) da config --
    o que deixa mcp_servers e caminhos de banco portaveis, sem caminho absoluto da maquina."""
    if isinstance(value, str):
        return value.replace("{office}", office_dir().as_posix())
    if isinstance(value, list):
        return [expand(v) for v in value]
    if isinstance(value, dict):
        return {k: expand(v) for k, v in value.items()}
    return value


def base_url() -> str:
    url = _cfg().get("url")
    if url:
        return url.rstrip("/")
    # server.json e reescrito pelo escritorio a cada start com a porta real
    try:
        port = json.loads((PIXEL_DIR / "server.json").read_text(encoding="utf-8")).get("port") or DEFAULT_PORT
    except (OSError, json.JSONDecodeError):
        port = DEFAULT_PORT
    return f"http://127.0.0.1:{port}"


def _headers() -> dict:
    try:
        token = (PIXEL_DIR / "brain" / "token").read_text(encoding="utf-8").strip()
    except OSError:
        token = ""
    return {"x-brain-token": token} if token else {}


def _get(path: str, **params):
    r = requests.get(f"{base_url()}/api/brain{path}", headers=_headers(), params=params, timeout=8)
    r.raise_for_status()
    return r.json()


def _send(method: str, path: str, body: dict | None = None):
    r = requests.request(method, f"{base_url()}/api/brain{path}", headers=_headers(), json=body or {}, timeout=60)
    if r.status_code >= 400:
        try:
            msg = r.json().get("error") or r.text
        except ValueError:
            msg = r.text
        raise RuntimeError(f"Brain Office recusou ({r.status_code}): {msg}")
    return r.json()


def call(method: str, path: str, body: dict | None = None, params: dict | None = None):
    """Repasse cru pra /api/brain (usado pelo proxy /api/office do servidor): devolve
    (status_http, json). O token do escritorio fica aqui no servidor, nunca vai pro navegador."""
    r = requests.request(method, f"{base_url()}/api/brain{path}", headers=_headers(),
                         json=body if method != "GET" else None, params=params, timeout=30)
    try:
        data = r.json()
    except ValueError:
        data = {"error": r.text[:300]}
    return r.status_code, data


def is_up() -> bool:
    try:
        return requests.get(f"{base_url()}/api/health", timeout=1.5).ok
    except requests.RequestException:
        return False


def start() -> str:
    """Sobe o escritorio (mesmo comando do `npm run office`) como processo independente. Ele
    tambem sobe o Planner Core, o agente, a voz e o Current Brain (supervisor de servicos)."""
    if is_up():
        return "O Brain Office ja esta rodando."
    repo = office_dir()
    cli = repo / "dist" / "cli.js"
    if not cli.exists():
        return f"Nao achei o build do Brain Office em {cli} (rode npm run build no brain-agents)."
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    log = open(Path(__file__).parent / "brain_office.log", "a", encoding="utf-8")
    subprocess.Popen(["node", str(cli), "--port", str(DEFAULT_PORT)], cwd=str(repo), stdout=log,
                     stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
    for _ in range(40):
        time.sleep(0.5)
        if is_up():
            return "Brain Office ligado. Os servicos (Planner Core, agente, Current Brain) sobem em seguida."
    return "Mandei ligar o Brain Office, mas ele ainda nao respondeu. Veja brain_office.log."


def agents() -> list[dict]:
    return _get("/agents").get("agents", [])


def status() -> str:
    lines = []
    for a in agents():
        if not a.get("active", True):
            continue
        extra = f" ({a['activity']})" if a.get("activity") else ""
        fila = f", {a['queued']} na fila" if a.get("queued") else ""
        lines.append(f"{a['key']} = {a.get('label', a['key'])}: {a.get('status', '?')}{extra}{fila}")
    perms = _get("/permissions").get("requests", [])
    if perms:
        lines.append(f"{len(perms)} pedido(s) de aprovacao pendente(s).")
    return "Agentes do escritorio:\n" + "\n".join(lines) if lines else "Nenhum agente ativo no escritorio."


def _resolve_agent(name: str) -> str | None:
    """Aceita a chave (setor-agenda), o rotulo (Agenda) ou so o nome do setor (agenda)."""
    n = (name or "").strip().lower()
    if not n:
        return None
    for a in agents():
        key, label = a["key"].lower(), str(a.get("label", "")).lower()
        if n in (key, label, key.replace("setor-", "")):
            return a["key"]
    return None


def _wait_reply(agent: str, since_ms: float, timeout: float) -> str:
    deadline = time.time() + timeout
    saw_work = False
    while time.time() < deadline:
        time.sleep(POLL_SECONDS)
        st = next((a for a in agents() if a["key"] == agent), {})
        state = st.get("status")
        if state == "aguardando_aprovacao":
            perms = [p for p in _get("/permissions").get("requests", []) if p.get("agent") == agent]
            desc = "; ".join(str(p.get("summary") or p.get("toolName") or p.get("id")) for p in perms) or "uma acao"
            return (f"O {st.get('label', agent)} parou pedindo aprovacao pra: {desc}. Pergunte ao usuario se aprova "
                    "e use escritorio com action=aprovar ou negar.")
        if state == "trabalhando" or st.get("queued"):
            saw_work = True
            continue
        entries = _get(f"/agents/{agent}/chat", limit=40).get("entries", [])
        fresh = [e for e in entries if e.get("ts", 0) >= since_ms and e.get("role") in ("agent", "error")]
        if fresh:
            last = fresh[-1]
            prefix = "Erro do agente: " if last["role"] == "error" else ""
            return prefix + last.get("text", "").strip()
        if saw_work:
            return "O agente terminou sem resposta em texto."
    return (f"O agente ainda esta trabalhando. A resposta vai aparecer no chat do {agent} no escritorio; "
            "pergunte de novo daqui a pouco com action=ultima_resposta.")


def ask(text: str, agent: str | None = None, timeout: float = REPLY_TIMEOUT) -> str:
    since = time.time() * 1000 - 1000
    if agent:
        key = _resolve_agent(agent)
        if not key:
            return f"Nao existe agente '{agent}' no escritorio. {status()}"
        _send("POST", f"/agents/{key}/messages", {"text": text})
        routed = ""
    else:
        r = _send("POST", "/route", {"text": text})
        key = r["agent"]
        routed = f"[Recepcao encaminhou para {key}: {r.get('reason', '')}]\n"
    return routed + _wait_reply(key, since, timeout)


def last_reply(agent: str) -> str:
    key = _resolve_agent(agent)
    if not key:
        return f"Nao existe agente '{agent}'."
    entries = [e for e in _get(f"/agents/{key}/chat", limit=40).get("entries", []) if e.get("role") in ("agent", "error")]
    return entries[-1]["text"] if entries else "Esse agente ainda nao respondeu nada."


def hoje() -> str:
    return json.dumps(_get("/hoje").get("hoje", {}), ensure_ascii=False)[:10000]


def board(limit: int = 15) -> str:
    posts = _get("/board", limit=limit).get("posts", [])
    lines = [f"[{time.strftime('%d/%m %H:%M', time.localtime(p['ts'] / 1000))}] {p.get('kind')} de {p.get('from')}"
             f"{' para ' + p['to'] if p.get('to') else ''}{' - ' + p['title'] if p.get('title') else ''}: "
             f"{str(p.get('text', ''))[:300]}" for p in posts[-limit:]]
    return "\n".join(lines) or "Mural vazio."


def reminders() -> str:
    rs = _get("/reminders").get("reminders", [])
    return "\n".join(f"{r['id']}: {r.get('agent')} - {r.get('text')}" for r in rs) or "Nenhum lembrete."


def add_reminder(text: str, agent: str | None = None, in_minutes: float | None = None, at: str | None = None,
                 every_minutes: float | None = None) -> str:
    key = _resolve_agent(agent or "") or "setor-agenda"
    body = {"agent": key, "text": text}
    if in_minutes is not None:
        body["inMinutes"] = in_minutes
    if at:
        body["at"] = at
    if every_minutes is not None:
        body["everyMinutes"] = every_minutes
    r = _send("POST", "/reminders", body)["reminder"]
    when = time.strftime("%d/%m %H:%M", time.localtime(r["nextAt"] / 1000)) if r.get("nextAt") else ""
    return f"Lembrete criado no escritorio ({key}){' para ' + when if when else ''}: {text}"


def cancel_reminder(rid: str) -> str:
    return "Lembrete cancelado." if _send("DELETE", f"/reminders/{rid}").get("ok") else "Lembrete nao encontrado."


def permissions() -> str:
    reqs = _get("/permissions").get("requests", [])
    return "\n".join(f"{p.get('id')}: {p.get('agent')} quer {p.get('summary') or p.get('toolName')}" for p in reqs) \
        or "Nenhum pedido de aprovacao pendente."


def resolve_permission(pid: str, allow: bool) -> str:
    reqs = _get("/permissions").get("requests", [])
    if not pid and len(reqs) == 1:
        pid = reqs[0].get("id")
    if not pid:
        return "Diga qual pedido: " + permissions()
    ok = _send("POST", f"/permissions/{pid}", {"allow": allow}).get("ok")
    return ("Aprovado." if allow else "Negado.") if ok else "Pedido nao encontrado (ja foi resolvido?)."


def run_brief() -> str:
    _send("POST", "/briefs/run")
    return "Pedi um brief novo ao escritorio; ele aparece na aba Briefs quando ficar pronto."
