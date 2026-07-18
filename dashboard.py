"""
Wy Glass — Dashboard (Tkinter, native window, no browser)
A HUD-styled control panel for the glasses: connection/device status, gesture
map, live event feed, API key configuration, passive-listening toggles. Talks
to the already-running server.py over its existing HTTP API + WebSocket (same
data the web /deck and /test panels use) — no new backend logic, just a
native, richer presentation + config-editing layer.
"""

import json
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import ttk

import requests

try:
    from websockets.sync.client import connect as ws_connect
except ImportError:
    ws_connect = None

BASE_URL = "http://127.0.0.1:8731"
WS_URL = "ws://127.0.0.1:8731/ws"
BASE_DIR = Path(__file__).parent


def _server_reachable() -> bool:
    try:
        requests.get(f"{BASE_URL}/api/status", timeout=1.5)
        return True
    except requests.RequestException:
        return False


def ensure_server_running():
    """The dashboard can be opened on its own (not just via a gesture) — if
    server.py isn't already up, start it as a fully detached process, so it
    keeps running independently even after this dashboard window is closed."""
    if _server_reachable():
        return
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    # DETACHED_PROCESS leaves the child with no console/stdout at all — without
    # redirecting somewhere, server.py's own print() calls crash it almost
    # immediately (AttributeError on a None stdout).
    log_file = open(BASE_DIR / "server_launcher.log", "a", encoding="utf-8")
    subprocess.Popen(
        [sys.executable, str(BASE_DIR / "server.py")],
        cwd=str(BASE_DIR),
        stdout=log_file, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        creationflags=creationflags, close_fds=True,
    )
    # give it a moment to bind the port before the dashboard starts polling
    for _ in range(20):
        if _server_reachable():
            break
        time.sleep(0.5)

BG0 = "#07090b"
BG1 = "#0d1116"
BG2 = "#121821"
BG3 = "#182330"
BORDER = "#1e2a35"
CYAN = "#28f5e0"
CYAN_DIM = "#1a8a80"
AMBER = "#ffb020"
GREEN = "#3dffa0"
RED = "#ff4d6a"
TEXT0 = "#e8f3f2"
TEXT1 = "#8fa3a8"
TEXT2 = "#516066"

FONT_MONO = ("Consolas", 10)
FONT_MONO_SM = ("Consolas", 9)
FONT_MONO_BOLD = ("Consolas", 10, "bold")
FONT_TITLE = ("Consolas", 19, "bold")
FONT_SUBTITLE = ("Consolas", 8)
FONT_SECTION = ("Consolas", 10, "bold")

# Credentials live in config["credentials"] — glasses-wide capabilities, not
# tied to any one gesture (server.py merges them into every action's params).
CREDENTIAL_LABELS = {
    "groq_api_key": "Groq (fala + busca + navegador + visão)",
    "tavily_api_key": "Tavily (busca na internet)",
    "google_api_key": "Google / Gemini (assistente alternativo)",
    "witai_token": "Wit.ai",
    "elevenlabs_api_key": "ElevenLabs (TTS, não usado por padrão)",
}

GESTURE_SLOTS = (
    "button1_single", "button1_double", "button1_triple",
    "button2_single", "button2_double", "button2_triple",
)

# every action type registered in actions.ACTIONS, plus the one special string
# server.py's fire_gesture() handles itself (never goes through actions.py)
ACTION_TYPES = (
    "run_command", "open_url", "key_shortcut", "screenshot", "voice_command",
    "jarvis_voice_agent", "open_jarvis_agent", "open_dashboard", "stop_conversation",
)

DEFAULT_PARAMS = {
    "run_command": {"command": "notepad.exe", "args": []},
    "open_url": {"url": "https://google.com"},
    "key_shortcut": {"keys": "ctrl+shift+s"},
    "screenshot": {"folder": "./screenshots"},
    "voice_command": {"duration_seconds": 4, "folder": "./recordings"},
    # nenhum destes precisa de campo de chave — server.py injeta as
    # credenciais globais (aba CONFIGURAÇÕES) automaticamente em todo gesto
    "jarvis_voice_agent": {
        "provider": "gemini", "model": "gemini-2.5-flash",
        "max_duration_seconds": 15, "silence_duration_seconds": 1, "silence_threshold": 300,
        "system_prompt": "Voce e um assistente de voz util, direto e simpatico. Responda em portugues do Brasil.",
        "tts_model": "pt_BR-faber-medium.onnx", "conversation_mode": False,
    },
    "open_jarvis_agent": {
        "session_id": "wyglass", "user_name": "sankofa",
        "user_role": "desenvolvedor e engenheiro de bugigangas tech",
        "tts_model": "pt_BR-faber-medium.onnx",
        "max_duration_seconds": 15, "silence_duration_seconds": 1, "silence_threshold": 400,
    },
    "open_dashboard": {},
    "stop_conversation": {"farewell_text": "Ate mais!", "tts_model": "pt_BR-faber-medium.onnx"},
}


def ts() -> str:
    return datetime.now().strftime("%H:%M:%S")


# ---------------------------------------------------------------- widgets --

class GlassesLogo(tk.Canvas):
    """Vector glasses mark — same silhouette as the project's web favicon
    (two lenses + bridge + temple arms), drawn on a Canvas so no image asset
    is needed."""

    def __init__(self, parent, size=52, color=CYAN, bg=BG0, **kw):
        h = int(size * 0.62)
        super().__init__(parent, width=size, height=h, bg=bg, highlightthickness=0, **kw)
        self._draw(size, h, color)

    def _draw(self, w, h, color):
        lw = max(3, round(w * 0.085))
        lens_w = w * 0.34
        lens_h = h * 0.66
        y0 = h * 0.24
        # temple arms (drawn first, behind the lenses)
        self.create_arc(-w * 0.16, y0 - h * 0.08, w * 0.22, y0 + lens_h * 0.55,
                         start=205, extent=95, style="arc", outline=color, width=lw)
        self.create_arc(w * 0.78, y0 - h * 0.08, w * 1.16, y0 + lens_h * 0.55,
                         start=-40, extent=95, style="arc", outline=color, width=lw)
        # lenses
        self.create_rectangle(w * 0.07, y0, w * 0.07 + lens_w, y0 + lens_h, outline=color, width=lw)
        self.create_rectangle(w * 0.59, y0, w * 0.59 + lens_w, y0 + lens_h, outline=color, width=lw)
        # bridge
        bx0 = w * 0.07 + lens_w
        bx1 = w * 0.59
        by = y0 + lens_h * 0.4
        self.create_line(bx0, by, bx1, by, fill=color, width=lw, capstyle="round")


class HudPanel(tk.Frame):
    """A bordered panel with a title and small corner-bracket HUD decorations."""

    def __init__(self, parent, title, **kw):
        super().__init__(parent, bg=BG1, highlightbackground=BORDER, highlightthickness=1, **kw)
        head = tk.Frame(self, bg=BG1)
        head.pack(fill="x", padx=10, pady=(8, 4))
        tk.Label(head, text=title, bg=BG1, fg=CYAN, font=FONT_SECTION).pack(side="left")
        line = tk.Frame(head, bg=BORDER, height=1)
        line.pack(side="left", fill="x", expand=True, padx=(8, 0), pady=6)
        self.body = tk.Frame(self, bg=BG1)
        self.body.pack(fill="both", expand=True)
        self._brackets()

    def _brackets(self):
        c = tk.Canvas(self, width=10, height=10, bg=BG1, highlightthickness=0)
        c.place(relx=1.0, rely=0.0, anchor="ne", x=-2, y=2)
        c.create_line(0, 0, 9, 0, fill=CYAN_DIM, width=2)
        c.create_line(9, 0, 9, 9, fill=CYAN_DIM, width=2)


class MaskedField(tk.Frame):
    """Label + masked Entry (API key style) with a show/hide toggle."""

    def __init__(self, parent, label_text, value="", width=34):
        super().__init__(parent, bg=BG1)
        tk.Label(self, text=label_text, bg=BG1, fg=TEXT1, font=FONT_MONO_SM,
                  anchor="w", width=26).pack(side="left")
        self.var = tk.StringVar(value=value)
        self.entry = tk.Entry(self, textvariable=self.var, show="•", width=width,
                               bg=BG2, fg=TEXT0, insertbackground=CYAN,
                               relief="flat", font=FONT_MONO_SM,
                               highlightbackground=BORDER, highlightthickness=1)
        self.entry.pack(side="left", padx=6, fill="x", expand=True)
        self.reveal_btn = tk.Button(self, text="◉", command=self._toggle, bg=BG2, fg=TEXT1,
                                     activebackground=BG2, relief="flat", font=FONT_MONO_SM,
                                     width=2, cursor="hand2")
        self.reveal_btn.pack(side="left")
        self._shown = False

    def _toggle(self):
        self._shown = not self._shown
        self.entry.config(show="" if self._shown else "•")
        self.reveal_btn.config(fg=CYAN if self._shown else TEXT1)

    def get(self) -> str:
        return self.var.get()


def scrollable(parent, bg=BG0):
    """Returns (outer_frame, inner_frame) — inner_frame scrolls vertically."""
    outer = tk.Frame(parent, bg=bg)
    canvas = tk.Canvas(outer, bg=bg, highlightthickness=0)
    vbar = tk.Scrollbar(outer, orient="vertical", command=canvas.yview)
    inner = tk.Frame(canvas, bg=bg)
    inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.create_window((0, 0), window=inner, anchor="nw")
    canvas.configure(yscrollcommand=vbar.set)
    canvas.pack(side="left", fill="both", expand=True)
    vbar.pack(side="right", fill="y")

    def _wheel(event):
        canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    canvas.bind_all("<MouseWheel>", _wheel, add="+")
    return outer, inner


# ---------------------------------------------------------------- app ------

class DashboardApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("WY GLASS · DASHBOARD")
        self.root.geometry("1000x760")
        self.root.minsize(820, 600)
        self.root.configure(bg=BG0)

        self.event_queue: "queue.Queue[dict]" = queue.Queue()
        self.connected = False
        self.actions_enabled = False
        self.gesture_rows: dict[str, str] = {}
        self.config_cache: dict = {}
        self._config_loaded_once = False
        self._pulse_up = True
        self._stop = threading.Event()

        # widgets populated once config first loads (Config tab)
        self.key_fields: dict[str, MaskedField] = {}
        self.addr_var = tk.StringVar()
        self.pl_enabled_var = tk.BooleanVar()
        self.clap_enabled_var = tk.BooleanVar()

        self._build_style()
        self._build_ui()

        threading.Thread(target=self._poll_config_loop, daemon=True).start()
        threading.Thread(target=self._ws_loop, daemon=True).start()
        self.root.after(120, self._drain_queue)
        self.root.after(500, self._tick_clock)
        self.root.after(600, self._pulse_dot)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------- styling ----------

    def _build_style(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("Treeview", background=BG1, fieldbackground=BG1, foreground=TEXT0,
                         bordercolor=BORDER, borderwidth=0, rowheight=26, font=FONT_MONO)
        style.map("Treeview", background=[("selected", CYAN_DIM)], foreground=[("selected", BG0)])
        style.configure("Treeview.Heading", background=BG2, foreground=CYAN,
                         font=FONT_MONO_BOLD, borderwidth=0, relief="flat")
        style.map("Treeview.Heading", background=[("active", BG2)])
        style.configure("TNotebook", background=BG0, borderwidth=0)
        style.configure("TNotebook.Tab", background=BG1, foreground=TEXT1, font=FONT_MONO_BOLD,
                         padding=(16, 8), borderwidth=0)
        style.map("TNotebook.Tab", background=[("selected", BG2)], foreground=[("selected", CYAN)])

    # ---------- top-level layout ----------

    def _build_ui(self):
        header = tk.Frame(self.root, bg=BG0)
        header.pack(fill="x", padx=18, pady=(14, 6))

        GlassesLogo(header, size=48).pack(side="left")
        title_box = tk.Frame(header, bg=BG0)
        title_box.pack(side="left", padx=(10, 0))
        tk.Label(title_box, text="WY GLASS", bg=BG0, fg=TEXT0, font=FONT_TITLE).pack(anchor="w")
        tk.Label(title_box, text="CONTROL DECK", bg=BG0, fg=TEXT2, font=FONT_SUBTITLE).pack(anchor="w")

        self.status_dot = tk.Canvas(header, width=14, height=14, bg=BG0, highlightthickness=0)
        self.status_dot.pack(side="left", padx=(24, 4))
        self._dot = self.status_dot.create_oval(2, 2, 12, 12, fill=RED, outline="")
        self.status_label = tk.Label(header, text="DESCONECTADO", bg=BG0, fg=RED, font=FONT_MONO_BOLD)
        self.status_label.pack(side="left")

        self.clock_label = tk.Label(header, text="", bg=BG0, fg=TEXT2, font=FONT_MONO)
        self.clock_label.pack(side="right")

        tk.Frame(self.root, bg=BORDER, height=1).pack(fill="x", padx=18)

        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill="both", expand=True, padx=18, pady=14)

        self.tab_status = tk.Frame(self.notebook, bg=BG0)
        self.tab_gestures = tk.Frame(self.notebook, bg=BG0)
        self.tab_config = tk.Frame(self.notebook, bg=BG0)
        self.notebook.add(self.tab_status, text="  STATUS  ")
        self.notebook.add(self.tab_gestures, text="  GESTOS  ")
        self.notebook.add(self.tab_config, text="  CONFIGURAÇÕES  ")

        self._build_status_tab(self.tab_status)
        self._build_gestures_tab(self.tab_gestures)
        self._build_config_tab(self.tab_config)

    # ---------- STATUS tab ----------

    def _build_status_tab(self, parent):
        parent.columnconfigure(0, weight=1)
        parent.columnconfigure(1, weight=1)
        parent.rowconfigure(1, weight=1)

        dev = HudPanel(parent, "DISPOSITIVO")
        dev.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=(0, 6))
        self.dev_fields = {}
        for key, label in (("device_name", "Nome"), ("firmware", "Firmware"), ("device_address", "Endereço")):
            row = tk.Frame(dev.body, bg=BG1)
            row.pack(fill="x", padx=12, pady=2)
            tk.Label(row, text=label.upper(), bg=BG1, fg=TEXT1, font=FONT_MONO, width=10, anchor="w").pack(side="left")
            val = tk.Label(row, text="—", bg=BG1, fg=TEXT0, font=FONT_MONO, anchor="w")
            val.pack(side="left", fill="x", expand=True)
            self.dev_fields[key] = val

        toggle_row = tk.Frame(dev.body, bg=BG1)
        toggle_row.pack(fill="x", padx=12, pady=(6, 4))
        tk.Label(toggle_row, text="AÇÕES REAIS", bg=BG1, fg=TEXT1, font=FONT_MONO, width=10, anchor="w").pack(side="left")
        self.actions_btn = tk.Button(
            toggle_row, text="—", command=self._toggle_actions, bg=BG2, fg=TEXT0,
            activebackground=BG2, font=FONT_MONO_BOLD, relief="flat", padx=10, pady=2, cursor="hand2",
        )
        self.actions_btn.pack(side="left")

        pl_row = tk.Frame(dev.body, bg=BG1)
        pl_row.pack(fill="x", padx=12, pady=(2, 10))
        tk.Label(pl_row, text="ESCUTA PASSIVA", bg=BG1, fg=TEXT1, font=FONT_MONO, width=10, anchor="w").pack(side="left")
        self.pl_status_label = tk.Label(pl_row, text="—", bg=BG1, fg=TEXT2, font=FONT_MONO_BOLD)
        self.pl_status_label.pack(side="left")

        conv = HudPanel(parent, "CONVERSA")
        conv.grid(row=0, column=1, sticky="nsew", padx=(6, 0), pady=(0, 6))
        self.conv_label = tk.Label(conv.body, text="ociosa", bg=BG1, fg=TEXT2, font=("Consolas", 15, "bold"))
        self.conv_label.pack(padx=12, pady=(10, 4))
        self.conv_sub = tk.Label(conv.body, text="clique no botão 1 dos óculos pra começar", bg=BG1, fg=TEXT2,
                                  font=FONT_SUBTITLE)
        self.conv_sub.pack(pady=(0, 10))

        ges = HudPanel(parent, "GESTOS CONFIGURADOS")
        ges.grid(row=1, column=0, sticky="nsew", padx=(0, 6), pady=6)
        cols = ("gesture", "label", "action")
        self.tree = ttk.Treeview(ges.body, columns=cols, show="headings", height=8)
        for c, w in zip(cols, (110, 210, 150)):
            self.tree.heading(c, text={"gesture": "Gesto", "label": "Descrição", "action": "Ação"}[c])
            self.tree.column(c, width=w, anchor="w")
        self.tree.pack(fill="both", expand=True, padx=10, pady=(0, 6))
        self.tree.bind("<Double-1>", self._on_gesture_double_click)
        tk.Label(ges.body, text="duplo-clique numa linha para disparar o gesto manualmente", bg=BG1, fg=TEXT2,
                 font=FONT_SUBTITLE).pack(anchor="w", padx=10, pady=(0, 8))

        log_wrap = HudPanel(parent, "EVENTOS AO VIVO")
        log_wrap.grid(row=1, column=1, sticky="nsew", padx=(6, 0), pady=6)
        self.log = tk.Text(log_wrap.body, bg=BG0, fg=TEXT0, font=("Consolas", 9), relief="flat",
                            wrap="word", state="disabled", padx=8, pady=6)
        self.log.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        for tag, color in (("gesture", CYAN), ("ok", GREEN), ("err", RED), ("status", AMBER), ("dim", TEXT2)):
            self.log.tag_configure(tag, foreground=color)

    # ---------- GESTOS tab ----------

    def _build_gestures_tab(self, parent):
        self._current_slot = None
        parent.columnconfigure(0, weight=0)
        parent.columnconfigure(1, weight=1)
        parent.rowconfigure(0, weight=1)

        left = HudPanel(parent, "SLOTS DE GESTO")
        left.grid(row=0, column=0, sticky="ns", padx=(0, 8))
        self.slot_listbox = tk.Listbox(
            left.body, bg=BG2, fg=TEXT2, selectbackground=CYAN_DIM, selectforeground=BG0,
            font=FONT_MONO, width=20, height=len(GESTURE_SLOTS), relief="flat",
            highlightthickness=0, activestyle="none", exportselection=False,
        )
        for slot in GESTURE_SLOTS:
            self.slot_listbox.insert("end", slot)
        self.slot_listbox.pack(padx=10, pady=(4, 4), fill="y")
        self.slot_listbox.bind("<<ListboxSelect>>", self._on_slot_select)
        tk.Label(left.body, text="cinza = vazio\nciano = configurado", bg=BG1, fg=TEXT2,
                 font=FONT_SUBTITLE, justify="left").pack(anchor="w", padx=10, pady=(0, 10))

        right = HudPanel(parent, "EDITAR GESTO")
        right.grid(row=0, column=1, sticky="nsew")

        row = tk.Frame(right.body, bg=BG1)
        row.pack(fill="x", padx=12, pady=(6, 4))
        tk.Label(row, text="RÓTULO", bg=BG1, fg=TEXT1, font=FONT_MONO_SM, width=12, anchor="w").pack(side="left")
        self.g_label_var = tk.StringVar()
        tk.Entry(row, textvariable=self.g_label_var, bg=BG2, fg=TEXT0, insertbackground=CYAN,
                  relief="flat", font=FONT_MONO_SM, highlightbackground=BORDER,
                  highlightthickness=1).pack(side="left", fill="x", expand=True, padx=6)

        row2 = tk.Frame(right.body, bg=BG1)
        row2.pack(fill="x", padx=12, pady=4)
        tk.Label(row2, text="AÇÃO", bg=BG1, fg=TEXT1, font=FONT_MONO_SM, width=12, anchor="w").pack(side="left")
        self.g_action_var = tk.StringVar()
        action_combo = ttk.Combobox(row2, textvariable=self.g_action_var, values=list(ACTION_TYPES),
                                     state="readonly", font=FONT_MONO_SM)
        action_combo.pack(side="left", padx=6, fill="x", expand=True)
        action_combo.bind("<<ComboboxSelected>>", self._on_action_type_change)

        tk.Label(right.body, text="PARÂMETROS (JSON)", bg=BG1, fg=TEXT1, font=FONT_MONO_SM,
                 anchor="w").pack(fill="x", padx=12, pady=(8, 2))
        self.g_params_text = tk.Text(right.body, bg=BG2, fg=TEXT0, insertbackground=CYAN,
                                       font=FONT_MONO_SM, relief="flat", height=14,
                                       highlightbackground=BORDER, highlightthickness=1)
        self.g_params_text.pack(fill="both", expand=True, padx=12, pady=(0, 4))

        self.g_error_label = tk.Label(right.body, text="", bg=BG1, fg=RED, font=FONT_MONO_SM, anchor="w")
        self.g_error_label.pack(fill="x", padx=12)

        btn_row = tk.Frame(right.body, bg=BG1)
        btn_row.pack(fill="x", padx=12, pady=(6, 12))
        tk.Button(btn_row, text="SALVAR GESTO", command=self._save_gesture, bg=BG2, fg=CYAN,
                  activebackground=BG3, relief="flat", font=FONT_MONO_BOLD, padx=10, pady=4,
                  cursor="hand2").pack(side="left")
        tk.Button(btn_row, text="TESTAR", command=self._test_current_gesture, bg=BG2, fg=AMBER,
                  activebackground=BG3, relief="flat", font=FONT_MONO_BOLD, padx=10, pady=4,
                  cursor="hand2").pack(side="left", padx=(8, 0))
        tk.Button(btn_row, text="LIMPAR SLOT", command=self._clear_gesture, bg=BG2, fg=RED,
                  activebackground=BG3, relief="flat", font=FONT_MONO_BOLD, padx=10, pady=4,
                  cursor="hand2").pack(side="left", padx=(8, 0))

    def _on_slot_select(self, _event):
        sel = self.slot_listbox.curselection()
        if not sel:
            return
        self._load_slot(self.slot_listbox.get(sel[0]))

    def _load_slot(self, slot: str):
        self._current_slot = slot
        gcfg = self.config_cache.get("gestures", {}).get(slot)
        if gcfg:
            self.g_label_var.set(gcfg.get("label", ""))
            self.g_action_var.set(gcfg.get("action", ""))
            params = gcfg.get("params", {})
        else:
            self.g_label_var.set("")
            self.g_action_var.set("")
            params = {}
        self.g_params_text.delete("1.0", "end")
        self.g_params_text.insert("1.0", json.dumps(params, ensure_ascii=False, indent=2))
        self.g_error_label.config(text="")

    def _on_action_type_change(self, _event):
        action = self.g_action_var.get()
        current = self.g_params_text.get("1.0", "end").strip()
        if current in ("", "{}"):
            defaults = DEFAULT_PARAMS.get(action, {})
            self.g_params_text.delete("1.0", "end")
            self.g_params_text.insert("1.0", json.dumps(defaults, ensure_ascii=False, indent=2))
        if not self.g_label_var.get().strip():
            self.g_label_var.set(action.replace("_", " ").title())

    def _refresh_slot_list(self):
        gestures = self.config_cache.get("gestures", {})
        for i, slot in enumerate(GESTURE_SLOTS):
            self.slot_listbox.itemconfig(i, fg=CYAN if slot in gestures else TEXT2)

    def _save_gesture(self):
        if not self._current_slot:
            self.g_error_label.config(text="selecione um slot na lista")
            return
        action = self.g_action_var.get().strip()
        if not action:
            self.g_error_label.config(text="escolha uma ação")
            return
        try:
            raw = self.g_params_text.get("1.0", "end").strip() or "{}"
            params = json.loads(raw)
        except json.JSONDecodeError as e:
            self.g_error_label.config(text=f"JSON inválido: {e}")
            return
        self.g_error_label.config(text="")
        label = self.g_label_var.get().strip() or self._current_slot
        gestures = self.config_cache.setdefault("gestures", {})
        gestures[self._current_slot] = {"label": label, "action": action, "params": params, "reliability": "high"}
        self._post_config({"gestures": gestures}, f"gesto {self._current_slot} salvo")
        self._refresh_slot_list()

    def _clear_gesture(self):
        if not self._current_slot:
            return
        gestures = self.config_cache.get("gestures", {})
        if gestures.pop(self._current_slot, None) is not None:
            self._post_config({"gestures": gestures}, f"gesto {self._current_slot} removido")
        self._load_slot(self._current_slot)
        self._refresh_slot_list()

    def _test_current_gesture(self):
        if not self._current_slot:
            return
        slot = self._current_slot

        def call():
            try:
                requests.post(f"{BASE_URL}/api/test/{slot}", timeout=5)
            except requests.RequestException as e:
                self.event_queue.put({"type": "_log", "tag": "err", "text": f"falha ao testar {slot}: {e}"})

        threading.Thread(target=call, daemon=True).start()

    # ---------- CONFIGURAÇÕES tab ----------

    def _build_config_tab(self, parent):
        outer, inner = scrollable(parent, bg=BG0)
        outer.pack(fill="both", expand=True)

        # connection settings
        conn = HudPanel(inner, "CONEXÃO BLE")
        conn.pack(fill="x", pady=(0, 10))
        row = tk.Frame(conn.body, bg=BG1)
        row.pack(fill="x", padx=12, pady=(4, 10))
        tk.Label(row, text="ENDEREÇO BLE", bg=BG1, fg=TEXT1, font=FONT_MONO_SM, width=26, anchor="w").pack(side="left")
        entry = tk.Entry(row, textvariable=self.addr_var, width=28, bg=BG2, fg=TEXT0,
                          insertbackground=CYAN, relief="flat", font=FONT_MONO_SM,
                          highlightbackground=BORDER, highlightthickness=1)
        entry.pack(side="left", padx=6)
        tk.Label(conn.body, text="mudar aqui reconecta no próximo ciclo de scan, sem precisar reiniciar o servidor",
                 bg=BG1, fg=TEXT2, font=FONT_SUBTITLE).pack(anchor="w", padx=12, pady=(0, 8))
        tk.Button(conn.body, text="SALVAR ENDEREÇO", command=self._save_address, bg=BG2, fg=CYAN,
                  activebackground=BG3, relief="flat", font=FONT_MONO_BOLD, padx=10, pady=4,
                  cursor="hand2").pack(anchor="w", padx=12, pady=(0, 10))

        # passive listening
        pl = HudPanel(inner, "ESCUTA PASSIVA (WAKE WORD / PALMA)")
        pl.pack(fill="x", pady=(0, 10))
        pl_row = tk.Frame(pl.body, bg=BG1)
        pl_row.pack(fill="x", padx=12, pady=(4, 4))
        tk.Checkbutton(pl_row, text="Escuta passiva ligada", variable=self.pl_enabled_var,
                        bg=BG1, fg=TEXT0, selectcolor=BG2, activebackground=BG1,
                        font=FONT_MONO_SM).pack(side="left")
        clap_row = tk.Frame(pl.body, bg=BG1)
        clap_row.pack(fill="x", padx=12, pady=(0, 4))
        tk.Checkbutton(clap_row, text="Detecção de palma dupla ligada", variable=self.clap_enabled_var,
                        bg=BG1, fg=TEXT0, selectcolor=BG2, activebackground=BG1,
                        font=FONT_MONO_SM).pack(side="left")
        tk.Label(pl.body, text="ambos desligados por padrão — calibração de threshold pendente (ver docs/07-roteiro-futuro.md)",
                 bg=BG1, fg=TEXT2, font=FONT_SUBTITLE).pack(anchor="w", padx=12, pady=(0, 8))
        tk.Button(pl.body, text="SALVAR ESCUTA PASSIVA", command=self._save_passive_listening, bg=BG2, fg=CYAN,
                  activebackground=BG3, relief="flat", font=FONT_MONO_BOLD, padx=10, pady=4,
                  cursor="hand2").pack(anchor="w", padx=12, pady=(0, 10))

        # API keys — glasses-wide capabilities, not tied to any one gesture
        self.keys_panel = HudPanel(inner, "CAPACIDADES (CHAVES DE API)")
        self.keys_panel.pack(fill="x", pady=(0, 10))
        tk.Label(self.keys_panel.body, text="uma chave por serviço, usada por qualquer gesto/agente que precisar dela",
                 bg=BG1, fg=TEXT2, font=FONT_SUBTITLE).pack(anchor="w", padx=12, pady=(0, 4))
        self.keys_container = tk.Frame(self.keys_panel.body, bg=BG1)
        self.keys_container.pack(fill="x", padx=12, pady=(4, 4))
        self.keys_placeholder = tk.Label(self.keys_container, text="carregando configuração do servidor...",
                                          bg=BG1, fg=TEXT2, font=FONT_MONO_SM)
        self.keys_placeholder.pack(anchor="w")
        self.keys_save_btn = tk.Button(self.keys_panel.body, text="SALVAR CAPACIDADES", command=self._save_keys,
                                        bg=BG2, fg=CYAN, activebackground=BG3, relief="flat",
                                        font=FONT_MONO_BOLD, padx=10, pady=4, cursor="hand2", state="disabled")
        self.keys_save_btn.pack(anchor="w", padx=12, pady=(4, 12))

        self.save_feedback = tk.Label(inner, text="", bg=BG0, fg=GREEN, font=FONT_MONO_SM)
        self.save_feedback.pack(anchor="w", pady=(0, 10))

    # ---------- background workers ----------

    def _poll_config_loop(self):
        while not self._stop.is_set():
            try:
                cfg = requests.get(f"{BASE_URL}/api/config", timeout=3).json()
                self.event_queue.put({"type": "_config", "data": cfg})
            except requests.RequestException:
                pass
            try:
                status = requests.get(f"{BASE_URL}/api/status", timeout=3).json()
                self.event_queue.put({"type": "_status_poll", "data": status})
            except requests.RequestException:
                self.event_queue.put({"type": "_server_unreachable"})
            time.sleep(4)

    def _ws_loop(self):
        if ws_connect is None:
            self.event_queue.put({"type": "_log", "tag": "err", "text": "biblioteca websockets nao encontrada"})
            return
        while not self._stop.is_set():
            try:
                with ws_connect(WS_URL, open_timeout=5) as ws:
                    while not self._stop.is_set():
                        try:
                            raw = ws.recv(timeout=5)
                        except TimeoutError:
                            continue
                        try:
                            self.event_queue.put(json.loads(raw))
                        except (json.JSONDecodeError, TypeError):
                            pass
            except Exception:
                time.sleep(3)

    # ---------- Tkinter-thread handlers ----------

    def _tick_clock(self):
        self.clock_label.config(text=datetime.now().strftime("%d/%m/%Y  %H:%M:%S"))
        self.root.after(500, self._tick_clock)

    def _pulse_dot(self):
        if self.connected:
            color = GREEN if self._pulse_up else "#1a7a52"
            self.status_dot.itemconfig(self._dot, fill=color)
            self._pulse_up = not self._pulse_up
        self.root.after(650, self._pulse_dot)

    def _drain_queue(self):
        try:
            while True:
                msg = self.event_queue.get_nowait()
                self._handle_message(msg)
        except queue.Empty:
            pass
        self.root.after(120, self._drain_queue)

    def _handle_message(self, msg: dict):
        t = msg.get("type")
        if t == "_config":
            self._apply_config(msg["data"])
        elif t == "_status_poll":
            self._apply_status(msg["data"])
        elif t == "_server_unreachable":
            self._set_connected(False, "SERVIDOR OFFLINE")
        elif t == "_log":
            self._append_log(msg.get("text", ""), msg.get("tag", "dim"))
        elif t == "status":
            connected = bool(msg.get("connected"))
            self._set_connected(connected, "CONECTADO" if connected else "DESCONECTADO")
            self._append_log(msg.get("message", ""), "status")
        elif t == "gesture":
            label = msg.get("label", msg.get("gesture", ""))
            note = msg.get("note", "")
            self._append_log(f"gesto: {label}" + (f" ({note})" if note else ""), "gesture")
        elif t == "action_result":
            ok = msg.get("ok", True)
            self._append_log(msg.get("message", ""), "ok" if ok else "err")
        elif t == "conversation":
            self._set_conversation(msg.get("status", ""))
        elif t == "actions_enabled":
            self.actions_enabled = bool(msg.get("enabled"))
            self._refresh_actions_btn()

    def _apply_config(self, cfg: dict):
        self.config_cache = cfg
        for key, widget in self.dev_fields.items():
            widget.config(text=str(cfg.get(key, "—")))
        self.actions_enabled = bool(cfg.get("actions_enabled", False))
        self._refresh_actions_btn()

        pl = cfg.get("passive_listening", {})
        pl_on = bool(pl.get("enabled"))
        self.pl_status_label.config(text="LIGADA" if pl_on else "desligada", fg=GREEN if pl_on else TEXT2)

        gestures = cfg.get("gestures", {})
        existing = set(self.gesture_rows.keys())
        seen = set()
        for gkey, gcfg in gestures.items():
            seen.add(gkey)
            label = gcfg.get("label", "")
            action = gcfg.get("action", "")
            if gkey in self.gesture_rows:
                self.tree.item(self.gesture_rows[gkey], values=(gkey, label, action))
            else:
                item = self.tree.insert("", "end", values=(gkey, label, action))
                self.gesture_rows[gkey] = item
        for stale in existing - seen:
            self.tree.delete(self.gesture_rows.pop(stale))

        self._refresh_slot_list()

        if not self._config_loaded_once:
            self._config_loaded_once = True
            self._populate_config_tab(cfg)

    def _populate_config_tab(self, cfg: dict):
        self.addr_var.set(cfg.get("device_address", ""))
        pl = cfg.get("passive_listening", {})
        self.pl_enabled_var.set(bool(pl.get("enabled")))
        self.clap_enabled_var.set(bool(pl.get("clap_detection", {}).get("enabled")))

        self.keys_placeholder.destroy()
        self.key_fields.clear()
        credentials = cfg.get("credentials", {})
        if not credentials:
            tk.Label(self.keys_container, text="nenhuma credencial configurada ainda",
                      bg=BG1, fg=TEXT2, font=FONT_MONO_SM).pack(anchor="w")
        else:
            for pname in sorted(credentials.keys()):
                label = CREDENTIAL_LABELS.get(pname, pname)
                field = MaskedField(self.keys_container, label, value=credentials.get(pname, ""))
                field.pack(fill="x", pady=2)
                self.key_fields[pname] = field
            self.keys_save_btn.config(state="normal")

    def _apply_status(self, status: dict):
        connected = bool(status.get("connected"))
        self._set_connected(connected, "CONECTADO" if connected else "DESCONECTADO")

    def _set_connected(self, connected: bool, label: str):
        self.connected = connected
        color = GREEN if connected else RED
        self.status_dot.itemconfig(self._dot, fill=color)
        self.status_label.config(text=label, fg=color)

    def _set_conversation(self, status: str):
        mapping = {
            "started": ("ATIVA", GREEN, "conversando..."),
            "ending": ("ENCERRANDO", AMBER, ""),
            "ended": ("ociosa", TEXT2, "clique no botão 1 dos óculos pra começar"),
        }
        text, color, sub = mapping.get(status, (status or "ociosa", TEXT2, ""))
        self.conv_label.config(text=text, fg=color)
        self.conv_sub.config(text=sub)

    def _refresh_actions_btn(self):
        if self.actions_enabled:
            self.actions_btn.config(text="LIGADAS", fg=GREEN)
        else:
            self.actions_btn.config(text="MODO TESTE", fg=AMBER)

    def _append_log(self, text: str, tag: str):
        if not text:
            return
        self.log.config(state="normal")
        self.log.insert("end", f"[{ts()}] {text}\n", tag)
        self.log.see("end")
        if int(self.log.index("end-1c").split(".")[0]) > 600:
            self.log.delete("1.0", "100.0")
        self.log.config(state="disabled")

    def _flash_feedback(self, text: str, ok: bool = True):
        self.save_feedback.config(text=text, fg=GREEN if ok else RED)
        self.root.after(4000, lambda: self.save_feedback.config(text=""))

    # ---------- actions ----------

    def _toggle_actions(self):
        new_val = not self.actions_enabled
        self.actions_enabled = new_val
        self._refresh_actions_btn()

        def call():
            try:
                requests.post(f"{BASE_URL}/api/actions_enabled", json={"enabled": new_val}, timeout=5)
            except requests.RequestException:
                pass

        threading.Thread(target=call, daemon=True).start()

    def _on_gesture_double_click(self, _event):
        sel = self.tree.selection()
        if not sel:
            return
        gesture_key = self.tree.item(sel[0], "values")[0]

        def call():
            try:
                requests.post(f"{BASE_URL}/api/test/{gesture_key}", timeout=5)
            except requests.RequestException:
                self.event_queue.put({"type": "_log", "tag": "err", "text": f"falha ao testar {gesture_key}"})

        threading.Thread(target=call, daemon=True).start()

    def _post_config(self, patch: dict, success_msg: str):
        def call():
            try:
                requests.post(f"{BASE_URL}/api/config", json=patch, timeout=5)
                self.event_queue.put({"type": "_log", "tag": "ok", "text": success_msg})
            except requests.RequestException as e:
                self.event_queue.put({"type": "_log", "tag": "err", "text": f"falha ao salvar: {e}"})

        threading.Thread(target=call, daemon=True).start()
        self._flash_feedback(success_msg)

    def _save_address(self):
        self.config_cache["device_address"] = self.addr_var.get().strip()
        self._post_config({"device_address": self.config_cache["device_address"]}, "endereço BLE salvo")

    def _save_passive_listening(self):
        pl = self.config_cache.setdefault("passive_listening", {})
        pl["enabled"] = self.pl_enabled_var.get()
        pl.setdefault("clap_detection", {})["enabled"] = self.clap_enabled_var.get()
        self._post_config({"passive_listening": pl}, "escuta passiva salva")

    def _save_keys(self):
        credentials = self.config_cache.setdefault("credentials", {})
        for pname, field in self.key_fields.items():
            credentials[pname] = field.get()
        self._post_config({"credentials": credentials}, "capacidades salvas")

    def _on_close(self):
        self._stop.set()
        try:
            from pathlib import Path
            lock = Path(__file__).parent / ".dashboard.lock"
            if lock.exists():
                lock.unlink()
        except OSError:
            pass
        self.root.destroy()


def main():
    ensure_server_running()
    root = tk.Tk()
    DashboardApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
