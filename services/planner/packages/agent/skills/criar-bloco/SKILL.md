---
name: criar-bloco
description: Cria blocos (widgets) e paineis do dashboard - HTML + CSS + funcao JS que le/grava dados, chama ferramentas e abre modais. Use quando o usuario pedir tela, painel, dashboard, widget ou visualizacao.
---

Bloco = `html` (dentro de `<div id=root>`) + `css` + `js` + permissoes (`read`, `write`, `tools`). Roda isolado, sem rede. Nasce **aguardando aprovacao**: avise o usuario para aprovar no Construtor. Sem permissao declarada, nada e acessado.

js: `planner.main(async function (ctx) { ... })` roda ao carregar, a cada `refreshSeconds` e em `ctx.refresh()`.

- `ctx.root`, `ctx.escape(txt)` (sempre ao pôr dados em innerHTML)
- `ctx.data.list(r, params?)` (read) | `create(r, corpo)`, `update(r, id, corpo)`, `remove(r, id)` (write)
- `ctx.tool(nome, args)` (tools)
- `ctx.ui.modal({title, size:"sm|md|lg", html, css?, js?})` abre modal por cima do dashboard; devolve o valor passado a `planner.close(valor)` dentro do modal (ou undefined se fechar). O modal herda as permissoes do bloco. `ctx.ui.confirm(msg)` -> boolean. `ctx.ui.toast(msg, "ok|warn|error")`.

Recursos (campos): tasks(id,title,status pending|in_progress|done|cancelled,projectId?,dueAt?,notes?), projects(id,name,goal?,progress), clients(id,name,stage,value,nextAction?), subjects(id,name,progress,note?,examDate?), study_topics(id,subjectId,title,done,dueAt?), schedule, study_sessions(durationMinutes,startedAt), research_lines, papers(title,status), habits(id,name,unit,target,current), memory(content,tags), messages(from,subject,handled), events, notes(path,title), calendar(title,start,end?,calendarName; params {limit}), google_tasks(title,due?,status).
Gravam (write): tasks, projects, clients, subjects, study_topics, habits, memory(create/remove), google_tasks. Ex: `update("tasks", id, {status:"done"})`.

Design system (ja injetado; use SO estas classes): layout `pl-stack pl-row pl-row-between pl-row-end pl-wrap pl-grow pl-grid pl-card`; texto `pl-title pl-subtitle pl-muted pl-big pl-link`; botoes `pl-btn` + `pl-btn-primary|pl-btn-danger|pl-btn-sm`; formulario `pl-field`(label+controle) `pl-input pl-select pl-textarea`; dados `pl-badge`(+`-ok|-warn|-accent`) `pl-bar`(<i style="width:60%">) `pl-table pl-list pl-tabs pl-tab pl-empty`; modal interno `pl-modal-backdrop pl-modal pl-modal-title pl-modal-actions`. Cores: `var(--pl-accent|--pl-muted|--pl-border|--pl-fg)`.

Exemplo de modal (JS de bloco): defina `function modalMain(ctx){ ...; planner.close(true); }` e chame `ctx.ui.modal({title:"Editar", size:"sm", html:"...", js:"planner.main(" + modalMain.toString() + ");"})`. Passe dados ao modal pelo html (com ctx.escape), ex: `data-id`.

Passos: 1) escolha recursos e declare so o necessario; 2) JS defensivo (lista vazia, try/catch em calendar); 3) `save_block`; 4) para por num painel: `save_dashboard` com `blocks:[{blockId,x,y,w,h}]`; 5) avise o usuario. Nao use fetch, links externos, localStorage, nem `run_claude_code`.
