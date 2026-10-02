"""
claude_code_agent.py — agente "Claude" do modo LIVE: delega a tarefa pro Claude Code CLI em modo
headless (`claude -p`), usando o login da sua assinatura Claude (Pro/Max) ja feito no CLI.

Por que o CLI e nao um proxy: o token OAuth da assinatura so pode ser usado pelo proprio Claude
Code — rotear ele por gateway de terceiro (9router, OmniRoute) viola os termos da assinatura.
Chamar o executavel oficial e uso normal do Claude Code, so que disparado pela voz nos oculos.

ANTHROPIC_API_KEY e removida do ambiente do subprocesso de proposito: se ela existir, o CLI
prefere a chave (cobranca por token na API) em vez da assinatura.

Config (config.json > claude_code):
    enabled          liga o agente (default true se o executavel existir)
    exe              caminho do claude.exe (default: auto-detecta)
    cwd              pasta onde o Claude Code trabalha (default: home do usuario)
    allowed_tools    ferramentas liberadas sem pedir permissao (default: so leitura + web)
    permission_mode  default "default" — headless nao tem quem aprove, entao o que nao estiver
                     em allowed_tools simplesmente e negado
    model            opcional (ex: "sonnet", "opus")
    timeout_seconds  default 180
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"]
DEFAULT_TIMEOUT = 180

_SPOKEN_STYLE = (
    "Sua resposta final vai ser lida em voz alta nos oculos do usuario por outro assistente. "
    "Responda em portugues do Brasil, no maximo 5 frases, sem markdown, sem listas, sem blocos de "
    "codigo e sem URLs cruas — diga o resultado como uma pessoa diria."
)


def find_executable(configured: str | None = None) -> str | None:
    candidates = [configured] if configured else []
    candidates += [
        str(Path.home() / ".local" / "bin" / ("claude.exe" if sys.platform == "win32" else "claude")),
        shutil.which("claude"),
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    return None


def is_available(cfg: dict | None = None) -> bool:
    cfg = cfg or {}
    return cfg.get("enabled", True) and find_executable(cfg.get("exe")) is not None


def run_task(task: str, cfg: dict | None = None) -> str:
    cfg = cfg or {}
    exe = find_executable(cfg.get("exe"))
    if not exe:
        return "Claude Code nao encontrado nesta maquina — instale o CLI e faca login com a assinatura."

    cmd = [exe, "-p", task, "--output-format", "json",
           "--append-system-prompt", _SPOKEN_STYLE,
           "--permission-mode", cfg.get("permission_mode", "default")]
    allowed = cfg.get("allowed_tools", DEFAULT_ALLOWED_TOOLS)
    if allowed:
        cmd += ["--allowedTools", *allowed]
    if cfg.get("model"):
        cmd += ["--model", cfg["model"]]

    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    cwd = cfg.get("cwd") or str(Path.home())
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8",
                              timeout=float(cfg.get("timeout_seconds", DEFAULT_TIMEOUT)),
                              stdin=subprocess.DEVNULL, creationflags=creationflags)
    except subprocess.TimeoutExpired:
        return "O Claude Code passou do tempo limite nessa tarefa."

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        err = (proc.stderr or proc.stdout or "").strip()[:300]
        return f"Claude Code falhou: {err or f'codigo {proc.returncode}'}"
    print(f"[claude_code_agent] turns={data.get('num_turns')} duration_ms={data.get('duration_ms')} "
          f"is_error={data.get('is_error')}", flush=True)
    result = (data.get("result") or "").strip()
    if data.get("is_error"):
        return f"Claude Code retornou erro: {result[:300]}"
    return result or "O Claude Code terminou sem nada a relatar."
