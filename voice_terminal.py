"""
voice_terminal.py — terminal por voz em cima da assinatura do Claude Code.

O usuario navega pelas pastas falando ("entra no wy-glass", "volta", "o que tem aqui?") e conversa
com o Claude Code na pasta atual pra construir coisas. Cada pasta tem a sua sessao do Claude Code
(--resume): o pedido seguinte continua a mesma conversa, como no terminal.

Os pedidos rodam em segundo plano (claude -p --output-format stream-json): o Jarvis responde na
hora ("mandei pro Claude") e avisa por voz quando termina; o painel Terminal do orb mostra o
andamento (arquivos lidos, editados, comandos) e a resposta em markdown, consultando /api/terminal.

Mesma regra do claude_code_agent.py: o executavel oficial com o login da assinatura, sem
ANTHROPIC_API_KEY no ambiente (com ela o CLI cobraria por token na API). Ferramentas liberadas vem
de config.json > claude_code.allowed_tools.
"""
import difflib
import json
import os
import re
import subprocess
import sys
import threading
import time
import unicodedata
import uuid
from pathlib import Path

import claude_code_agent

STATE_FILE = Path(__file__).parent / "data" / "voice_terminal.json"
DEFAULT_ROOT = Path.home() / "Documents" / "repo"
MAX_ENTRIES = 300
TASK_TIMEOUT_S = 30 * 60
_SKIP_DIRS = {"node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build", ".next", ".idea"}

_STYLE = (
    "Voce e operado por voz: o usuario fala com voce pelos oculos inteligentes, um assistente "
    "repassa o pedido e le em voz alta a PRIMEIRA FRASE da sua resposta final. Comece a resposta "
    "final com uma frase curta em portugues do Brasil, sem markdown, dizendo o que foi feito ou o "
    "que precisa dele. Depois dela pode detalhar em markdown (aparece num painel na tela). "
    "Quando faltar informacao pra seguir, pergunte de forma objetiva."
)

_lock = threading.RLock()
_hooks = {"emit": None, "announce": None}
_state = {"cwd": None, "sessions": {}, "entries": [], "busy": False, "task": None, "proc": None}


def set_hooks(emit=None, announce=None):
    """emit(payload) manda evento pro orb (WebSocket); announce(text) fala pelo Live/Piper."""
    _hooks["emit"], _hooks["announce"] = emit, announce


def _emit(payload: dict):
    if _hooks["emit"]:
        try:
            _hooks["emit"](payload)
        except Exception as e:
            print(f"[voice_terminal] emit falhou: {e}", flush=True)


# ---- estado persistido (pasta atual + sessao por pasta) -----------------------------------------
def _load():
    if _state["cwd"] is not None:
        return
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    cwd = Path(data.get("cwd") or DEFAULT_ROOT)
    _state["cwd"] = cwd if cwd.is_dir() else (DEFAULT_ROOT if DEFAULT_ROOT.is_dir() else Path.home())
    _state["sessions"] = data.get("sessions", {})


def _save():
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"cwd": str(_state["cwd"]), "sessions": _state["sessions"]},
                                     ensure_ascii=False, indent=2), encoding="utf-8")


def _add(kind: str, text: str, **extra):
    entry = {"kind": kind, "text": text, "time": time.strftime("%H:%M:%S"), **extra}
    with _lock:
        _state["entries"].append(entry)
        del _state["entries"][:-MAX_ENTRIES]
    _emit({"type": "terminal_event", "entry": entry})


def cwd() -> Path:
    with _lock:
        _load()
        return _state["cwd"]


def snapshot(limit: int = 120) -> dict:
    with _lock:
        _load()
        c = _state["cwd"]
        return {"cwd": str(c), "name": c.name, "busy": _state["busy"], "task": _state["task"],
                "has_session": str(c) in _state["sessions"], "entries": _state["entries"][-limit:]}


# ---- navegacao ---------------------------------------------------------------------------------
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _subdirs(path: Path) -> list[Path]:
    try:
        return sorted((p for p in path.iterdir() if p.is_dir() and p.name not in _SKIP_DIRS
                       and not p.name.startswith(".")), key=lambda p: p.name.lower())
    except OSError:
        return []


def _match_dir(name: str, candidates: list[Path]) -> Path | None:
    """Nome falado -> pasta: "wy glass" acha wy-glass, "brain agents" acha brain-agents."""
    q = _norm(name)
    if not q:
        return None
    best, score = None, 0.0
    for p in candidates:
        n = _norm(p.name)
        s = 1.0 if n == q else 0.92 if q in n or n in q else difflib.SequenceMatcher(None, q, n).ratio()
        if s > score:
            best, score = p, s
    return best if score >= 0.7 else None


def listing(path: Path | None = None) -> str:
    path = path or cwd()
    dirs = _subdirs(path)
    try:
        files = [p for p in path.iterdir() if p.is_file()]
    except OSError:
        files = []
    marks = []
    if (path / ".git").exists():
        marks.append("repositorio git")
    for f, label in (("package.json", "projeto Node"), ("pyproject.toml", "projeto Python"),
                     ("requirements.txt", "projeto Python"), ("CLAUDE.md", "tem CLAUDE.md")):
        if (path / f).exists() and label not in marks:
            marks.append(label)
    head = f"Pasta {path.name} ({path})" + (f" — {', '.join(marks)}" if marks else "")
    names = ", ".join(d.name for d in dirs[:40]) or "nenhuma"
    return f"{head}. Subpastas ({len(dirs)}): {names}. Arquivos: {len(files)}."


def change_dir(target: str) -> str:
    """Entra numa pasta pelo nome falado. Aceita "voltar"/"..", "inicio"/"repo", caminho absoluto,
    nome de subpasta (aproximado) ou de uma pasta ate 2 niveis abaixo da raiz de projetos."""
    _load()
    t = (target or "").strip()
    cur = _state["cwd"]
    nt = _norm(t)
    if nt in ("", "inicio", "repo", "raiz", "home projetos", "projetos"):
        new = DEFAULT_ROOT
    elif nt in ("voltar", "volta", "anterior", "pasta de cima", "sobe", "subir") or t == "..":
        new = cur.parent if cur != Path.home() else cur
    elif Path(t).is_absolute() and Path(t).is_dir():
        new = Path(t)
    else:
        new = _match_dir(t, _subdirs(cur))
        if new is None:  # procura nos projetos (2 niveis), pra "abre o projeto X" de qualquer lugar
            deep = [d for top in _subdirs(DEFAULT_ROOT) for d in [top, *_subdirs(top)]]
            new = _match_dir(t, deep)
        if new is None:
            return f"Nao achei a pasta '{target}' aqui. {listing(cur)}"
    with _lock:
        _state["cwd"] = new
        _save()
    _add("nav", f"cd {new}")
    _emit({"type": "terminal_state"})
    return listing(new) + (" Ja existe uma conversa do Claude Code nesta pasta; o proximo pedido continua ela."
                           if str(new) in _state["sessions"] else "")


def new_session() -> str:
    with _lock:
        _load()
        _state["sessions"].pop(str(_state["cwd"]), None)
        _save()
    _add("nav", "nova conversa do Claude Code nesta pasta")
    return f"Ok, o proximo pedido comeca uma conversa nova do Claude Code em {_state['cwd'].name}."


# ---- Claude Code -------------------------------------------------------------------------------
def _tool_line(name: str, inp: dict) -> str:
    base = lambda p: Path(str(p)).name if p else ""  # noqa: E731
    if name in ("Read", "Edit", "Write", "NotebookEdit"):
        verb = {"Read": "leu", "Edit": "editou", "Write": "criou/escreveu", "NotebookEdit": "editou"}[name]
        return f"{verb} {base(inp.get('file_path') or inp.get('notebook_path'))}"
    if name == "Bash":
        return f"$ {str(inp.get('command', ''))[:160]}"
    if name in ("Glob", "Grep"):
        return f"buscou {inp.get('pattern', '')}"
    if name in ("WebSearch", "WebFetch"):
        return f"web: {inp.get('query') or inp.get('url', '')}"
    if name in ("Task", "Agent"):
        return f"subagente: {inp.get('description', '')}"
    if name == "TodoWrite":
        todos = inp.get("todos") or []
        doing = next((t.get("content") for t in todos if t.get("status") == "in_progress"), "")
        return f"plano: {len(todos)} passos" + (f" — agora: {doing}" if doing else "")
    return name


def _first_sentence(text: str) -> str:
    plain = re.sub(r"[`*_#>\[\]]", "", text or "").strip()
    m = re.match(r"(.+?[.!?])(\s|$)", plain.replace("\n", " "))
    return (m.group(1) if m else plain[:220]).strip()


def ask(text: str) -> str:
    """Manda o pedido pro Claude Code na pasta atual, em segundo plano. Devolve na hora."""
    cfg = _config()
    exe = claude_code_agent.find_executable(cfg.get("exe"))
    if not exe:
        return "Claude Code nao encontrado nesta maquina — instale o CLI e faca login com a assinatura."
    with _lock:
        _load()
        if _state["busy"]:
            return f"O Claude Code ainda esta trabalhando em: {_state['task']}. Peca pra parar ou espere."
        _state["busy"], _state["task"] = True, text[:200]
        folder = _state["cwd"]
    _add("user", text)
    _emit({"type": "terminal_state"})
    threading.Thread(target=_run, args=(exe, text, folder, cfg), daemon=True, name="voice-terminal").start()
    return (f"Mandei pro Claude Code em {folder.name}. Ele esta trabalhando; aviso quando terminar e o "
            f"andamento aparece no painel Terminal.")


def stop() -> str:
    with _lock:
        proc = _state["proc"]
    if proc is None:
        return "O Claude Code nao esta rodando nada agora."
    try:
        proc.kill()
    except OSError:
        pass
    _add("error", "interrompido pelo usuario")
    return "Parei o Claude Code."


def _config() -> dict:
    try:
        cfg = json.loads((Path(__file__).parent / "config.json").read_text(encoding="utf-8"))
        return cfg.get("claude_code") or {}
    except (OSError, ValueError):
        return {}


def _run(exe: str, text: str, folder: Path, cfg: dict):
    key = str(folder)
    sid = _state["sessions"].get(key)
    cmd = [exe, "-p", text, "--output-format", "stream-json", "--verbose",
           "--append-system-prompt", _STYLE, "--permission-mode", cfg.get("permission_mode", "default")]
    cmd += ["--resume", sid] if sid else ["--session-id", str(uuid.uuid4())]
    allowed = cfg.get("allowed_tools", claude_code_agent.DEFAULT_ALLOWED_TOOLS)
    if allowed:
        cmd += ["--allowedTools", *allowed]
    if cfg.get("model"):
        cmd += ["--model", cfg["model"]]
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    result_text, ok, started = "", False, time.monotonic()
    try:
        proc = subprocess.Popen(cmd, cwd=str(folder), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                                creationflags=flags)
        with _lock:
            _state["proc"] = proc
        killer = threading.Timer(TASK_TIMEOUT_S, proc.kill)
        killer.start()
        try:
            for line in proc.stdout:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                kind = ev.get("type")
                if ev.get("session_id"):
                    with _lock:
                        if _state["sessions"].get(key) != ev["session_id"]:
                            _state["sessions"][key] = ev["session_id"]
                            _save()
                if kind == "assistant":
                    for part in (ev.get("message") or {}).get("content") or []:
                        if part.get("type") == "tool_use":
                            _add("tool", _tool_line(part.get("name", ""), part.get("input") or {}))
                        elif part.get("type") == "text" and part.get("text", "").strip():
                            _add("assistant", part["text"].strip())
                elif kind == "result":
                    result_text = (ev.get("result") or "").strip()
                    ok = not ev.get("is_error")
            proc.wait(timeout=10)
        finally:
            killer.cancel()
        if not result_text and proc.returncode not in (0, None):
            result_text = (proc.stderr.read() or "").strip()[:400] or f"codigo {proc.returncode}"
    except Exception as e:
        result_text, ok = f"Falha ao rodar o Claude Code: {e}", False
    finally:
        with _lock:
            _state["busy"], _state["task"], _state["proc"] = False, None, None
    secs = time.monotonic() - started
    if ok:
        _add("done", f"terminou em {secs:.0f}s")
    else:
        _add("error", result_text or "o Claude Code parou sem resposta")
    _emit({"type": "terminal_state"})
    spoken = _first_sentence(result_text) if ok else f"O Claude Code teve um problema: {_first_sentence(result_text)}"
    if _hooks["announce"] and spoken:
        try:
            _hooks["announce"](f"Claude Code em {folder.name}: {spoken}")
        except Exception as e:
            print(f"[voice_terminal] announce falhou: {e}", flush=True)
