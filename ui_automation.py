"""
ui_automation.py — o que da pra clicar na tela, direto do Windows (UI Automation).

Clicar so por visao (print + modelo apontando coordenada) e lento (5-10 s por clique) e erra: no
botao Iniciar, um modelo apontou o meio da barra e outro o widget do clima. A UI Automation
entrega os botoes, links, abas e campos da janela em foco e da barra de tarefas com o nome e o
retangulo exatos -- clicar vira achar pelo nome. A visao fica de reserva pra janelas que nao
expoem acessibilidade (jogos, canvas).

Uma chamada FindAllBuildCache traz nome, tipo e retangulo de todos os elementos de uma vez (cada
propriedade lida sem cache seria uma ida e volta entre processos).
"""
import ctypes
import difflib
import re
import unicodedata
from dataclasses import dataclass

import threading

_local = threading.local()  # um cliente COM por thread: a coleta roda em thread com prazo
ROOT_DEADLINE_S = 3.5  # janela com arvore gigante (WhatsApp, apps Electron) nao trava o clique

# tipos de controle que fazem sentido clicar/focar
_CLICKABLE = {
    50000: "botao", 50005: "link", 50011: "item de menu", 50019: "aba", 50007: "item de lista",
    50004: "campo", 50002: "caixa de selecao", 50003: "combo", 50024: "item de arvore",
    50013: "opcao", 50031: "botao dividido", 50020: "texto", 50025: "item", 50029: "celula",
    50018: "lista de abas",
}
_MAX_ELEMENTS = 400
# palavras que so dizem ONDE esta o elemento: o resto da descricao pode ser so isso pra casar direto
_WHERE = set("windows barra tarefas tela canto superior inferior direito direita esquerdo esquerda topo "
             "cima baixo lado janela aqui aberto aberta icone app aplicativo programa pagina site e em".split())


@dataclass
class Element:
    name: str
    kind: str
    rect: tuple[int, int, int, int]  # pixels fisicos

    @property
    def center(self) -> tuple[int, int]:
        left, top, right, bottom = self.rect
        return (left + right) // 2, (top + bottom) // 2


def _client():
    if getattr(_local, "uia", None) is None:
        import comtypes
        import comtypes.client
        comtypes.CoInitialize()
        comtypes.client.GetModule("UIAutomationCore.dll")
        from comtypes.gen import UIAutomationClient as mod
        try:
            # IUIAutomation2 aceita limite de tempo: um app travado (ou que recusa a chamada)
            # segurava a coleta inteira por ~18 s
            uia = comtypes.client.CreateObject(mod.CUIAutomation8, interface=mod.IUIAutomation2)
            uia.ConnectionTimeout = 1500
            uia.TransactionTimeout = 2500
        except Exception:
            uia = comtypes.client.CreateObject(mod.CUIAutomation, interface=mod.IUIAutomation)
        _local.uia, _local.mod = uia, mod
    return _local.uia, _local.mod


def _collect_hwnd(hwnd: int) -> list[Element]:
    """Coleta de uma janela numa thread com prazo: se a arvore for grande demais, segue sem ela
    (a thread termina sozinha depois, o resultado e descartado)."""
    box: list = []

    def work():
        try:
            uia, mod = _client()
            box.append(_collect(uia.ElementFromHandle(hwnd), uia, mod))
        except Exception as e:  # janela fechou no meio, ou nao expoe UIA
            print(f"[ui_automation] {hwnd}: {str(e)[:100]}", flush=True)

    t = threading.Thread(target=work, daemon=True)
    t.start()
    t.join(ROOT_DEADLINE_S)
    if t.is_alive():
        print(f"[ui_automation] {hwnd}: arvore grande demais, seguindo sem ela", flush=True)
        return []
    return box[0] if box else []


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def _collect(root, uia, mod) -> list[Element]:
    cond = None
    for ct in _CLICKABLE:
        c = uia.CreatePropertyCondition(mod.UIA_ControlTypePropertyId, ct)
        cond = c if cond is None else uia.CreateOrCondition(cond, c)
    cond = uia.CreateAndCondition(uia.CreatePropertyCondition(mod.UIA_IsOffscreenPropertyId, False), cond)
    cache = uia.CreateCacheRequest()
    for prop in (mod.UIA_NamePropertyId, mod.UIA_ControlTypePropertyId, mod.UIA_BoundingRectanglePropertyId):
        cache.AddProperty(prop)
    found = root.FindAllBuildCache(mod.TreeScope_Descendants, cond, cache)
    out = []
    for i in range(min(found.Length, _MAX_ELEMENTS * 2)):
        el = found.GetElement(i)
        name = (el.CachedName or "").strip()
        r = el.CachedBoundingRectangle
        if not name or r.right - r.left < 4 or r.bottom - r.top < 4:
            continue
        out.append(Element(name[:120], _CLICKABLE.get(el.CachedControlType, "elemento"),
                           (r.left, r.top, r.right, r.bottom)))
        if len(out) >= _MAX_ELEMENTS:
            break
    return out


def elements() -> list[Element]:
    """Elementos clicaveis visiveis: janela em foco primeiro, depois a barra de tarefas."""
    import pyautogui  # noqa: F401 -- DPI awareness: retangulos em pixels fisicos, iguais aos do clique
    u32 = ctypes.windll.user32
    roots = []
    fg = u32.GetForegroundWindow()
    if fg:
        roots.append(fg)
    tray = u32.FindWindowW("Shell_TrayWnd", None)
    if tray and tray != fg:
        roots.append(tray)
    out = []
    for hwnd in roots:
        out += _collect_hwnd(hwnd)
    return out


def match(description: str, elems: list[Element]) -> Element | None:
    """Casamento direto por nome: so devolve quando um elemento e claramente o pedido."""
    q = _norm(description)
    # palavras de tipo ("botao", "link"...) ajudam o modelo mas atrapalham o casamento por nome
    q = re.sub(r"\b(botao|link|aba|campo|icone|item|menu|opcao|o|a|do|da|de|no|na)\b", " ", q)
    q = re.sub(r"\s+", " ", q).strip()
    if not q:
        return None
    padded = f" {q} "
    scored = []
    for e in elems:
        # icones da barra de tarefas vem com sufixo ("Google Chrome - 1 janela em execucao"):
        # o que conta e o nome antes do " - "
        n = _norm(e.name.split(" - ")[0])
        if not n:
            continue
        if n == q:
            s = 1.0
        elif len(q) >= 4 and q in n:  # pedido curto dentro do nome ("enviar" em "Enviar agora")
            s = 0.9 if len(q) / len(n) > 0.4 else 0.8
        elif len(n) >= 4 and f" {n} " in padded and set(padded.replace(f" {n} ", " ").split()) <= _WHERE:
            # nome inteiro dentro de uma descricao que so acrescenta onde ele fica ("Iniciar na
            # barra de tarefas"); qualquer outra coisa ("fechar a aba do YouTube") e o modelo
            # que decide -- casar so "Fechar" fecharia a janela errada
            s = 0.88 + min(len(n), 30) / 1000  # o nome mais longo contido ganha
        else:
            s = difflib.SequenceMatcher(None, q, n).ratio()
        scored.append((s, e))
    scored.sort(key=lambda x: -x[0])
    if not scored or scored[0][0] < 0.85:
        return None
    best = scored[0][0]
    ties = [e for s, e in scored if s >= best - 0.005]
    # mesmo nome como texto e como botao: fica o clicavel
    clickable = [e for e in ties if e.kind != "texto"]
    if len(clickable) == 1:
        return clickable[0]
    # mesmo nome repetido (ex.: "Fechar" em varias abas): ambiguo, deixa o modelo decidir
    return ties[0] if len(ties) == 1 else None


PICK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash"]


def pick_with_model(description: str, elems: list[Element], google_api_key: str) -> Element | None:
    """Pedido ambiguo: o modelo escolhe na LISTA de nomes (so texto, sem imagem -- ~1 s)."""
    import json
    from google import genai
    from google.genai import types
    if not elems or not google_api_key:
        return None
    lines = "\n".join(f"{i}: [{e.kind}] {e.name}" for i, e in enumerate(elems))
    prompt = ("Elementos clicaveis na tela do usuario (indice: [tipo] nome). Qual deles corresponde ao "
              f"pedido? Responda SO JSON {{\"index\": n}} ou {{\"index\": -1}} se nenhum.\n"
              f"Pedido: {description}\n\n{lines}")
    # 503 de "high demand" acontece: cai pro proximo modelo rapido em vez de esperar
    client = genai.Client(api_key=google_api_key, http_options=types.HttpOptions(
        timeout=10_000, retry_options=types.HttpRetryOptions(attempts=1)))  # a API recusa prazo < 10 s
    for model in PICK_MODELS:
        thinking = (types.ThinkingConfig(thinking_budget=0) if "2.5" in model
                    else types.ThinkingConfig(thinking_level="minimal"))
        try:
            resp = client.models.generate_content(
                model=model, contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0,
                                                   thinking_config=thinking))
            idx = int(json.loads(resp.text).get("index", -1))
            return elems[idx] if 0 <= idx < len(elems) else None
        except Exception as e:
            print(f"[ui_automation] escolha falhou em {model}: {str(e)[:100]}", flush=True)
    return None


def summary(elems: list[Element], limit: int = 60) -> str:
    """Lista curta pro agente saber o que da pra clicar."""
    seen, lines = set(), []
    for e in elems:
        key = (e.kind, e.name)
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"[{e.kind}] {e.name}")
        if len(lines) >= limit:
            break
    return "\n".join(lines)
