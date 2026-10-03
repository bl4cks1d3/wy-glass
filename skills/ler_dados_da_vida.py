"""Porta pro oculos da ferramenta mcp__escritorio__ler_dados_da_vida do Brain Office
(brain-agents/server/src/brain/brainService.ts): o "escritorio" e um MCP em processo, que so
existe com o Brain Office rodando -- esta skill le os MESMOS bancos direto, somente leitura, e
funciona com o Brain Office e o Planner Core desligados. Escritas continuam pelo planner-life MCP.

Caminhos: <office>/data/{planner,brain} por padrao (brain_office.office_dir); config.json >
brain_office (repo_dir, planner_db, brain_db) sobrescreve, aceitando {office}."""
import json
import sqlite3
from datetime import datetime
from pathlib import Path

_AREAS = {
    "agenda": ["agora", "tarefasPendentes"],
    "faculdade": ["agora", "faculdade"],
    "clientes": ["agora", "clientes", "inboxSemTratar"],
    "projetos": ["agora", "projetos", "tarefasPendentes"],
    "pessoal": ["agora", "habitos"],
    "pesquisa": ["agora", "currentBrain"],
}

SCHEMA = {
    "type": "function",
    "function": {
        "name": "ler_dados_da_vida",
        "description": (
            "Retrato da vida do usuario lido direto dos bancos do Brain Office: tarefas pendentes, "
            "projetos, clientes, faculdade (disciplinas, provas, entregas), habitos, inbox e o "
            "resumo do Current Brain (brief do dia, itens prioritarios, estudos). Use pra qualquer "
            "pergunta sobre o dia, prazos, compromissos, o que fazer agora ou como estao as coisas. "
            "So leitura: pra criar/alterar algo use o Planner Life."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "area": {"type": "string", "enum": list(_AREAS),
                         "description": "filtra por setor; omita para o retrato completo"},
            },
        },
    },
}


def _paths() -> tuple[Path, Path]:
    import brain_office
    cfg = json.loads((Path(__file__).parent.parent / "config.json").read_text(encoding="utf-8"))
    bo = cfg.get("brain_office") or {}
    repo = brain_office.office_dir()
    planner = Path(brain_office.expand(bo.get("planner_db") or "") or repo / "data/planner/planner.db")
    brain = Path(brain_office.expand(bo.get("brain_db") or "") or repo / "data/brain/brain.db")
    return planner, brain


def _open(path: Path):
    if not path.exists():
        return None
    try:
        db = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=3)
        db.execute("SELECT 1")
    except sqlite3.Error:
        # banco em WAL sem -shm acessivel: le um snapshot imutavel em vez de falhar
        db = sqlite3.connect(f"file:{path.as_posix()}?immutable=1", uri=True)
    db.row_factory = sqlite3.Row
    return db


def _all(db, sql: str, *params) -> list[dict]:
    try:
        return [dict(r) for r in db.execute(sql, params).fetchall()]
    except sqlite3.Error:
        return []  # tabela/coluna ausente nesta versao do app


def _planner(db) -> dict:
    tasks = _all(db, "SELECT title, due_at, status FROM tasks WHERE status NOT IN ('done','cancelled') "
                     "ORDER BY due_at IS NULL, due_at, created_at DESC LIMIT 40")
    topics = _all(db, "SELECT title, due_at FROM study_topics WHERE done = 0 AND due_at IS NOT NULL "
                      "ORDER BY due_at LIMIT 20")
    return {
        "tarefasPendentes": [{"titulo": t["title"], "prazo": t["due_at"], "status": t["status"]} for t in tasks],
        "projetos": [{"nome": p["name"], "progresso": p.get("progress"), "objetivo": p.get("goal")}
                     for p in _all(db, "SELECT name, progress, goal FROM projects ORDER BY updated_at DESC")],
        "clientes": [{"nome": c["name"], "etapa": c.get("stage"), "valor": c.get("value"),
                      "proximaAcao": c.get("next_action"), "quando": c.get("next_action_at")}
                     for c in _all(db, "SELECT name, stage, value, next_action, next_action_at FROM clients "
                                       "ORDER BY updated_at DESC")],
        "faculdade": {
            "disciplinas": [{"nome": s["name"], "prova": s.get("exam_date"), "progresso": s.get("progress")}
                            for s in _all(db, "SELECT name, exam_date, progress FROM subjects ORDER BY name")],
            "entregas": [{"titulo": t["title"], "prazo": t["due_at"]} for t in topics],
        },
        "habitos": [{"nome": h["name"], "atual": h.get("current"), "meta": h.get("target"), "unidade": h.get("unit")}
                    for h in _all(db, "SELECT name, current, target, unit FROM habits ORDER BY name")],
        "inboxSemTratar": (_all(db, "SELECT count(*) AS n FROM messages WHERE handled = 0") or [{"n": 0}])[0]["n"],
    }


def _brain(db) -> dict:
    out = {}
    b = _all(db, "SELECT date, headline, intro, next_move FROM briefs ORDER BY date DESC, created_at DESC LIMIT 1")
    if b:
        try:
            move = json.loads(b[0].get("next_move") or "null")
        except json.JSONDecodeError:
            move = None
        out["brief"] = {"data": b[0]["date"], "manchete": (b[0].get("headline") or "").replace("\\n", "\n"),
                        "intro": b[0].get("intro"), "proximoPasso": move}
    out["prioritarios"] = [
        {"titulo": r["title"], "prioridade": r["priority"], "porque": r.get("why_it_matters")}
        for r in _all(db, "SELECT title, priority, why_it_matters FROM contents WHERE status = 'analyzed' "
                          "AND user_state = 'UNREAD' AND priority IN ('P0','P1','P2') "
                          "ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, analyzed_at DESC LIMIT 8")]
    out["estudando"] = [{"titulo": r["title"], "trilha": r.get("track"), "progresso": r.get("progress")}
                        for r in _all(db, "SELECT title, track, progress FROM learning_items WHERE progress < 100 "
                                          "ORDER BY updated_at DESC LIMIT 6")]
    out["pendentesDeTriagem"] = (_all(db, "SELECT count(*) AS n FROM contents WHERE status = 'pending'") or [{"n": 0}])[0]["n"]
    return out


def execute(args: dict, ctx: dict) -> tuple[str, bool]:
    planner_path, brain_path = _paths()
    data = {"agora": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %z")}
    pdb = _open(planner_path)
    if pdb is None:
        data["planner"] = f"banco nao encontrado: {planner_path}"
    else:
        with pdb:
            data.update(_planner(pdb))
        pdb.close()
    bdb = _open(brain_path)
    if bdb is None:
        data["currentBrain"] = f"banco nao encontrado: {brain_path}"
    else:
        data["currentBrain"] = _brain(bdb)
        bdb.close()
    area = args.get("area")
    if area in _AREAS:
        data = {k: data.get(k) for k in _AREAS[area]}
    return json.dumps(data, ensure_ascii=False, default=str)[:12000], False
