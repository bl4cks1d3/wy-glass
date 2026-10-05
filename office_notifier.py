"""
office_notifier.py — notificacoes do Brain Office no oculos.

O escritorio emite um evento "nudge" (SSE em /api/brain/events) pra todo aviso que precisa chegar
ao usuario: lembretes agendados, notificacoes do Planner ("Tarefa atrasada: ...", Google Tasks) e
mensagens que os agentes mandam com falar_com_usuario. Aqui uma thread fica assinando esse canal
(reconectando sozinha se o escritorio cair) e repassa cada aviso pro callback do server.py.
"""
import json
import threading
import time

import requests

import brain_office

_thread: threading.Thread | None = None
_stop = threading.Event()


def _listen(on_nudge):
    backoff = 5
    while not _stop.is_set():
        try:
            if not brain_office.is_up():
                raise ConnectionError("escritorio fora")
            with requests.get(f"{brain_office.base_url()}/api/brain/events", headers=brain_office._headers(),
                              stream=True, timeout=(5, 90)) as r:
                r.raise_for_status()
                backoff = 5
                for line in r.iter_lines(decode_unicode=True):
                    if _stop.is_set():
                        return
                    if not line or not line.startswith("data: "):
                        continue  # ": ping" de keepalive
                    try:
                        ev = json.loads(line[6:])
                    except ValueError:
                        continue
                    if ev.get("type") == "nudge":
                        n = ev.get("nudge") or {}
                        try:
                            on_nudge(n.get("text", ""), n.get("agent", ""))
                        except Exception as e:
                            print(f"[office_notifier] callback falhou: {e!r}", flush=True)
        except Exception:
            pass  # escritorio desligado/reiniciando: tenta de novo com espera crescente
        _stop.wait(backoff)
        backoff = min(60, backoff * 2)


def start(on_nudge):
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_listen, args=(on_nudge,), daemon=True, name="office_notifier")
    _thread.start()


def stop():
    _stop.set()
