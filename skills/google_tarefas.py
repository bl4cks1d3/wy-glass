"""Google Tasks pela voz: listar, concluir, reabrir e criar, pela conta conectada no Planner Core
(google_bridge). O usuario fala o nome da tarefa, nao o id: concluir/reabrir acham a tarefa pelo
titulo (aproximado) e, se mais de uma servir, devolvem as opcoes em vez de chutar."""
import difflib
import json

import google_bridge
from wake_spotter import normalize

SCHEMA = {
    "type": "function",
    "function": {
        "name": "google_tarefas",
        "description": (
            "Tarefas do Google Tasks do usuario. acao=listar mostra as pendentes; acao=concluir marca "
            "como feita (\"ok\", \"feito\", \"terminei X\"); acao=reabrir desmarca; acao=criar adiciona "
            "uma nova. Para concluir/reabrir passe o titulo como o usuario falou."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "acao": {"type": "string", "enum": ["listar", "concluir", "reabrir", "criar"]},
                "titulo": {"type": "string", "description": "titulo (ou parte) da tarefa"},
                "notas": {"type": "string", "description": "so pra criar"},
                "prazo": {"type": "string", "description": "so pra criar: data AAAA-MM-DD"},
            },
            "required": ["acao"],
        },
    },
}


def _score(query: str, title: str) -> float:
    q, t = normalize(query), normalize(title)
    if not q or not t:
        return 0.0
    if q == t:
        return 1.0
    if q in t:
        return 0.9
    return difflib.SequenceMatcher(None, q, t).ratio()


def _find(query: str, tasks: list[dict]) -> list[dict]:
    scored = sorted(((_score(query, t.get("title", "")), t) for t in tasks), key=lambda x: -x[0])
    if not scored or scored[0][0] < 0.55:
        return []
    best = scored[0][0]
    # empate tecnico entre varias = ambiguo; uma claramente melhor = ela
    return [t for s, t in scored if s >= best - 0.05]


def _brief(t: dict) -> dict:
    return {k: t.get(k) for k in ("id", "title", "due", "notes", "status") if t.get(k)}


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    acao = args.get("acao", "listar")
    titulo = (args.get("titulo") or "").strip()
    try:
        if acao == "criar":
            if not titulo:
                return "Diga o titulo da tarefa.", False
            t = google_bridge.create_task(titulo, args.get("notas", ""), args.get("prazo", ""))
            return json.dumps({"criada": _brief(t)}, ensure_ascii=False), True
        if acao == "listar":
            tasks = google_bridge.list_tasks()
            return json.dumps({"pendentes": [_brief(t) for t in tasks]}, ensure_ascii=False), True
        if not titulo:
            return "Diga qual tarefa (o titulo).", False
        done = acao == "concluir"
        # reabrir procura entre as concluidas; concluir, entre as pendentes
        pool = [t for t in google_bridge.list_tasks(include_completed=True)
                if (t.get("status") == "completed") != done]
        hits = _find(titulo, pool)
        if not hits:
            return json.dumps({"erro": f"nenhuma tarefa {'pendente' if done else 'concluida'} parecida com '{titulo}'",
                               "opcoes": [t.get("title") for t in pool[:15]]}, ensure_ascii=False), False
        if len(hits) > 1:
            return json.dumps({"ambiguo": "mais de uma tarefa serve; pergunte qual",
                               "opcoes": [t.get("title") for t in hits[:6]]}, ensure_ascii=False), False
        google_bridge.set_task_done(hits[0]["id"], done)
        return json.dumps({"concluida" if done else "reaberta": hits[0].get("title")}, ensure_ascii=False), True
    except RuntimeError as e:
        return f"Google Tasks: {e}", False
    except Exception as e:  # rede/Planner Core fora
        return f"Google Tasks indisponivel: {google_bridge._friendly(str(e))}", False
