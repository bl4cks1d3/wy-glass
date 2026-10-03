import type { BlockPermissions, Rect } from '@planner-life/shared';

export interface SeedBlock {
  id: string;
  name: string;
  description: string;
  html: string;
  css: string;
  js: string;
  permissions: BlockPermissions;
  refreshSeconds: number;
}

export interface SeedItem {
  blockId: string;
  grid: Rect;
}

// O codigo destes blocos NAO usa template literals: fica dentro de strings TS
// e serve de exemplo de como escrever um bloco (planner.main + planner.data).

const RESUMO: SeedBlock = {
  id: 'builtin-resumo',
  name: 'Resumo do dia',
  description: 'Contadores de tarefas, atrasos, projetos e compromissos de hoje.',
  permissions: { read: ['tasks', 'projects', 'calendar'], write: [], tools: [] },
  refreshSeconds: 60,
  html: `<div class="stats" id="stats">Carregando…</div>`,
  css: `.stats{display:flex;flex-wrap:wrap;gap:8px 28px;align-items:flex-end}
.k .pl-big{display:block}
.k.late .pl-big{color:var(--pl-accent)}`,
  js: `planner.main(async function (ctx) {
  var results = await Promise.all([
    ctx.data.list("tasks"),
    ctx.data.list("projects"),
    ctx.data.list("calendar", { limit: 30 }).catch(function () { return []; })
  ]);
  var tasks = results[0], projects = results[1], events = results[2];
  var open = tasks.filter(function (t) { return t.status === "pending" || t.status === "in_progress"; });
  var today = new Date().toISOString().slice(0, 10);
  var late = open.filter(function (t) { return t.dueAt && String(t.dueAt).slice(0, 10) < today; }).length;
  var todays = events.filter(function (e) { return String(e.start).slice(0, 10) === today; }).length;
  function stat(n, label, cls) {
    return '<div class="k ' + (cls || "") + '"><span class="pl-big">' + n + '</span><span class="pl-muted">' + label + '</span></div>';
  }
  ctx.root.querySelector("#stats").innerHTML =
    stat(open.length, "tarefas abertas") +
    stat(late, "atrasadas", late ? "late" : "") +
    stat(projects.length, "projetos") +
    stat(todays, "compromissos hoje");
});`,
};

const TAREFAS: SeedBlock = {
  id: 'builtin-tarefas',
  name: 'Tarefas',
  description: 'Lista as tarefas abertas, permite adicionar, concluir e editar (em modal).',
  permissions: { read: ['tasks'], write: ['tasks'], tools: [] },
  refreshSeconds: 0,
  html: `<div class="pl-row"><input class="pl-input" id="novo" placeholder="Nova tarefa e Enter"><button class="pl-btn pl-btn-primary" id="add">+</button></div><div class="pl-list" id="lista"></div>`,
  css: `.item{display:flex;align-items:center;gap:8px}
.item .t{flex:1;overflow-wrap:anywhere}
.item.late .d{color:var(--pl-accent)}`,
  js: `// Modal de edicao: roda em um iframe proprio, por cima do dashboard, com as
// MESMAS permissoes deste bloco. Devolve true (salvou) ou null via planner.close.
function modalMain(ctx) {
  var id = ctx.root.querySelector("[data-id]").getAttribute("data-id");
  ctx.root.querySelector("#cancelar").onclick = function () { planner.close(null); };
  ctx.root.querySelector("#salvar").onclick = async function () {
    var title = ctx.root.querySelector("#titulo").value.trim();
    if (!title) return;
    var due = ctx.root.querySelector("#prazo").value;
    await ctx.data.update("tasks", id, { title: title, dueAt: due || null });
    planner.close(true);
  };
}

planner.main(async function (ctx) {
  var input = ctx.root.querySelector("#novo");
  var lista = ctx.root.querySelector("#lista");
  async function add() {
    var title = input.value.trim();
    if (!title) return;
    input.value = "";
    await ctx.data.create("tasks", { title: title });
    ctx.refresh();
  }
  ctx.root.querySelector("#add").onclick = add;
  input.onkeydown = function (e) { if (e.key === "Enter") add(); };

  var tasks = await ctx.data.list("tasks");
  var today = new Date().toISOString().slice(0, 10);
  var open = tasks.filter(function (t) { return t.status === "pending" || t.status === "in_progress"; });
  open.sort(function (a, b) { return String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")); });
  if (!open.length) { lista.innerHTML = '<div class="pl-empty">Nada pendente.</div>'; return; }
  var byId = {};
  open.forEach(function (t) { byId[t.id] = t; });
  lista.innerHTML = open.slice(0, 30).map(function (t) {
    var late = t.dueAt && String(t.dueAt).slice(0, 10) < today;
    return '<div class="item ' + (late ? "late" : "") + '"><button class="pl-btn pl-btn-sm" data-done="' + ctx.escape(t.id) + '" title="Concluir">✓</button>' +
      '<span class="t pl-link" data-edit="' + ctx.escape(t.id) + '" title="Editar">' + ctx.escape(t.title) + '</span>' +
      (t.dueAt ? '<span class="d pl-muted">' + ctx.escape(String(t.dueAt).slice(0, 10)) + '</span>' : "") + '</div>';
  }).join("");

  Array.prototype.forEach.call(lista.querySelectorAll("[data-done]"), function (b) {
    b.onclick = async function () {
      await ctx.data.update("tasks", b.getAttribute("data-done"), { status: "done" });
      ctx.refresh();
    };
  });
  Array.prototype.forEach.call(lista.querySelectorAll("[data-edit]"), function (el) {
    el.onclick = async function () {
      var t = byId[el.getAttribute("data-edit")];
      var saved = await ctx.ui.modal({
        title: "Editar tarefa",
        size: "sm",
        html: '<div class="pl-stack" data-id="' + ctx.escape(t.id) + '">' +
          '<div class="pl-field"><label>Título</label><input class="pl-input" id="titulo" value="' + ctx.escape(t.title) + '"></div>' +
          '<div class="pl-field"><label>Prazo</label><input class="pl-input" id="prazo" type="date" value="' + ctx.escape(String(t.dueAt || "").slice(0, 10)) + '"></div>' +
          '<div class="pl-row pl-row-end"><button class="pl-btn" id="cancelar">Cancelar</button><button class="pl-btn pl-btn-primary" id="salvar">Salvar</button></div></div>',
        js: "planner.main(" + modalMain.toString() + ");"
      });
      if (saved) ctx.refresh();
    };
  });
});`,
};

const AGENDA: SeedBlock = {
  id: 'builtin-agenda',
  name: 'Próximos compromissos',
  description: 'Próximos eventos do Google Calendar.',
  permissions: { read: ['calendar'], write: [], tools: [] },
  refreshSeconds: 300,
  html: `<div id="lista">Carregando…</div>`,
  css: `.ev{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--pl-border)}
.ev .h{min-width:74px;font-weight:600}
.ev .c{font-size:11px}`,
  js: `planner.main(async function (ctx) {
  var lista = ctx.root.querySelector("#lista");
  var events;
  try { events = await ctx.data.list("calendar", { limit: 8 }); }
  catch (e) { lista.innerHTML = '<div class="pl-empty">Google Calendar indisponível.</div>'; return; }
  if (!events.length) { lista.innerHTML = '<div class="pl-empty">Nenhum compromisso próximo.</div>'; return; }
  lista.innerHTML = events.map(function (e) {
    var d = new Date(e.start);
    var quando = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return '<div class="ev"><span class="h">' + ctx.escape(quando) + '</span><span><div>' + ctx.escape(e.title) +
      '</div><div class="c pl-muted">' + ctx.escape(e.calendarName || "") + '</div></span></div>';
  }).join("");
});`,
};

const PROJETOS: SeedBlock = {
  id: 'builtin-projetos',
  name: 'Projetos',
  description: 'Progresso de cada projeto.',
  permissions: { read: ['projects'], write: [], tools: [] },
  refreshSeconds: 0,
  html: `<div id="lista">Carregando…</div>`,
  css: `.p{margin:0 0 12px}.p .n{display:flex;justify-content:space-between;margin-bottom:4px}`,
  js: `planner.main(async function (ctx) {
  var projects = await ctx.data.list("projects");
  var lista = ctx.root.querySelector("#lista");
  if (!projects.length) { lista.innerHTML = '<div class="pl-empty">Nenhum projeto.</div>'; return; }
  lista.innerHTML = projects.map(function (p) {
    return '<div class="p"><div class="n"><span>' + ctx.escape(p.name) + '</span><span class="pl-muted">' + p.progress +
      '%</span></div><div class="pl-bar"><i style="width:' + Math.max(0, Math.min(100, p.progress)) + '%"></i></div></div>';
  }).join("");
});`,
};

const HABITOS: SeedBlock = {
  id: 'builtin-habitos',
  name: 'Hábitos',
  description: 'Progresso dos hábitos, com botão +1.',
  permissions: { read: ['habits'], write: ['habits'], tools: [] },
  refreshSeconds: 0,
  html: `<div id="lista">Carregando…</div>`,
  css: `.h{margin:0 0 12px}.h .n{display:flex;align-items:center;gap:8px;margin-bottom:4px}.h .n span:first-child{flex:1}`,
  js: `planner.main(async function (ctx) {
  var habits = await ctx.data.list("habits");
  var lista = ctx.root.querySelector("#lista");
  if (!habits.length) { lista.innerHTML = '<div class="pl-empty">Nenhum hábito.</div>'; return; }
  lista.innerHTML = habits.map(function (h) {
    var pct = h.target ? Math.min(100, Math.round((h.current / h.target) * 100)) : 0;
    return '<div class="h"><div class="n"><span>' + ctx.escape(h.name) + '</span><span class="pl-muted">' + h.current + "/" + h.target + " " +
      ctx.escape(h.unit || "") + '</span><button class="pl-btn" data-id="' + ctx.escape(h.id) + '" data-cur="' + h.current + '">+1</button></div>' +
      '<div class="pl-bar"><i style="width:' + pct + '%"></i></div></div>';
  }).join("");
  Array.prototype.forEach.call(lista.querySelectorAll("button[data-id]"), function (b) {
    b.onclick = async function () {
      await ctx.data.update("habits", b.getAttribute("data-id"), { current: Number(b.getAttribute("data-cur")) + 1 });
      ctx.refresh();
    };
  });
});`,
};

const ENTREGAS: SeedBlock = {
  id: 'builtin-entregas',
  name: 'Entregas e leituras',
  description: 'Tópicos de estudo com prazo, de todas as disciplinas.',
  permissions: { read: ['study_topics', 'subjects'], write: [], tools: [] },
  refreshSeconds: 0,
  html: `<div id="lista">Carregando…</div>`,
  css: `.e{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--pl-border)}.e .d{min-width:74px;font-weight:600}.e .s{font-size:11px}`,
  js: `planner.main(async function (ctx) {
  var res = await Promise.all([ctx.data.list("study_topics"), ctx.data.list("subjects")]);
  var names = {};
  res[1].forEach(function (s) { names[s.id] = s.name; });
  var due = res[0].filter(function (t) { return t.dueAt && !t.done; });
  due.sort(function (a, b) { return String(a.dueAt).localeCompare(String(b.dueAt)); });
  var lista = ctx.root.querySelector("#lista");
  if (!due.length) { lista.innerHTML = '<div class="pl-empty">Nenhuma entrega com prazo.</div>'; return; }
  lista.innerHTML = due.slice(0, 20).map(function (t) {
    return '<div class="e"><span class="d">' + ctx.escape(String(t.dueAt).slice(5, 10).split("-").reverse().join("/")) + '</span><span><div>' +
      ctx.escape(t.title) + '</div><div class="s pl-muted">' + ctx.escape(names[t.subjectId] || "") + '</div></span></div>';
  }).join("");
});`,
};

const RELOGIO: SeedBlock = {
  id: 'builtin-relogio',
  name: 'Relógio',
  description: 'Hora e data. Não usa nenhuma permissão: exemplo de bloco só de interface.',
  permissions: { read: [], write: [], tools: [] },
  refreshSeconds: 0,
  html: `<div class="c"><div class="pl-big" id="h"></div><div class="pl-muted" id="d"></div></div>`,
  css: `.c{text-align:center}`,
  js: `planner.main(function (ctx) {
  function tick() {
    var now = new Date();
    ctx.root.querySelector("#h").textContent = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    ctx.root.querySelector("#d").textContent = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  }
  tick();
  if (!window.__relogio) window.__relogio = setInterval(tick, 15000);
});`,
};

export const SEED_BLOCKS: SeedBlock[] = [
  RESUMO,
  TAREFAS,
  AGENDA,
  RELOGIO,
  HABITOS,
  PROJETOS,
  ENTREGAS,
];

export const BASIC_DASHBOARD = {
  id: 'builtin-basico',
  name: 'Básico',
  mode: 'grid' as const,
  items: [
    { blockId: 'builtin-resumo', grid: { x: 0, y: 0, w: 12, h: 3 } },
    { blockId: 'builtin-tarefas', grid: { x: 0, y: 3, w: 5, h: 9 } },
    { blockId: 'builtin-agenda', grid: { x: 5, y: 3, w: 4, h: 9 } },
    { blockId: 'builtin-relogio', grid: { x: 9, y: 3, w: 3, h: 3 } },
    { blockId: 'builtin-habitos', grid: { x: 9, y: 6, w: 3, h: 6 } },
    { blockId: 'builtin-projetos', grid: { x: 0, y: 12, w: 6, h: 6 } },
    { blockId: 'builtin-entregas', grid: { x: 6, y: 12, w: 6, h: 6 } },
  ] as SeedItem[],
};
