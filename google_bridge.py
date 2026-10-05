"""
google_bridge.py — Google Agenda e Google Tasks no oculos, via Planner Core (services/planner).

O Planner Core guarda o OAuth da conta Google e expoe /integrations/google/*. A rota que o painel
"Hoje" usa (calendar) engole erro e devolve lista vazia -- com o token expirado a agenda simplesmente
sumia sem aviso. Aqui usamos calendar/range, que devolve o erro por conta, e traduzimos o caso mais
comum ("invalid_grant": autorizacao expirada/revogada -- apps OAuth em modo de teste expiram em 7
dias) pra uma mensagem que diz o que fazer.
"""
import os
import webbrowser
from datetime import datetime, timedelta

import requests

TIMEOUT = 12


def core_url() -> str:
    return f"http://127.0.0.1:{os.environ.get('CORE_PORT', '4000')}"


def auth_url() -> str:
    return f"{core_url()}/integrations/google/auth"


def _friendly(message: str) -> str:
    m = (message or "").lower()
    if "invalid_grant" in m or "expired or revoked" in m:
        return "A autorização do Google expirou ou foi revogada. Reconecte a conta."
    if "nao esta conectada" in m or "nenhuma conta" in m:
        return "Nenhuma conta Google conectada."
    if "fetch failed" in m or "timed out" in m:
        return "Sem conexão com o Google agora (rede)."
    return (message or "erro desconhecido")[:200]


def snapshot(days: int = 7) -> dict:
    """Eventos dos proximos `days` dias + tarefas pendentes do Google Tasks + erros legiveis."""
    out = {"events": [], "tasks": [], "errors": [], "connected": False, "auth_url": auth_url()}
    try:
        status = requests.get(f"{core_url()}/integrations/google/status", timeout=TIMEOUT).json()
        out["connected"] = bool(status.get("connected"))
        out["accounts"] = [a.get("email") for a in status.get("accounts", [])]
    except requests.RequestException:
        out["errors"].append("Planner Core fora do ar (o Brain Office sobe ele).")
        return out
    start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    try:
        r = requests.get(f"{core_url()}/integrations/google/calendar/range", timeout=TIMEOUT, params={
            "from": start.isoformat(), "to": (start + timedelta(days=days)).isoformat()})
        data = r.json()
        out["events"] = data.get("events", [])
        out["errors"] += [_friendly(e.get("message", "")) for e in data.get("errors", [])]
    except (requests.RequestException, ValueError) as e:
        out["errors"].append(_friendly(str(e)))
    try:
        r = requests.get(f"{core_url()}/integrations/google/tasks", timeout=TIMEOUT)
        if r.ok:
            out["tasks"] = [t for t in r.json() if t.get("status") != "completed"]
        else:
            try:
                msg = r.json().get("message", r.text)
            except ValueError:
                msg = r.text
            out["errors"].append(_friendly(msg if "invalid_grant" in str(msg) else "Google Tasks: " + str(msg)))
    except requests.RequestException as e:
        out["errors"].append(_friendly(str(e)))
    out["errors"] = list(dict.fromkeys(out["errors"]))  # mesma causa nas duas rotas = um aviso so
    out["ok"] = not out["errors"]
    return out


def open_reconnect() -> str:
    """Abre o fluxo OAuth do Planner Core no navegador padrao -- o usuario entra na conta Google."""
    webbrowser.open(auth_url())
    return "Abri a reconexão do Google no navegador. Entre na sua conta e autorize."
