// Central do orb: as areas do Brain Office (Hoje, Agenda, Faculdade, Clientes, Projetos, Pesquisa,
// Vida, Agentes, Mural) dentro do oculos, no visual do orb. Dados via /api/office/* (proxy do
// server.py pro /api/brain do escritorio). Abre pelo dock, por voz (tool abrir_central) ou Ctrl+K.
(() => {
  const U = () => window.wyCards.ui;
  const ICON = {
    hoje: '<path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',
    agenda: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    faculdade: '<path d="M3 9l9-4 9 4-9 4-9-4Z"/><path d="M7 11v5c3 2 7 2 10 0v-5"/>',
    clientes:
      '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6M21 19c0-2-1.5-4-4-4.6"/>',
    projetos: '<path d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    pesquisa: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.3-4.3"/>',
    vida: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z"/>',
    agentes: '<path d="M5 18v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1"/><circle cx="12" cy="7" r="3"/>',
    mural: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  };
  const SECTIONS = [
    { id: 'hoje', label: 'Hoje', color: '#ff9f0a' },
    { id: 'agenda', label: 'Agenda', color: '#ff375f' },
    { id: 'faculdade', label: 'Faculdade', color: '#5e5ce6' },
    { id: 'clientes', label: 'Clientes', color: '#30d158' },
    { id: 'projetos', label: 'Projetos', color: '#0a84ff' },
    { id: 'pesquisa', label: 'Pesquisa & Tec', color: '#bf5af2' },
    { id: 'vida', label: 'Vida & Casa', color: '#ff6482' },
    { id: 'agentes', label: 'Agentes', color: '#64d2ff' },
    { id: 'mural', label: 'Mural', color: '#8e8e93' },
  ];
  const svg = (id) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[id]}</svg>`;

  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <div class="ct" id="ct" role="dialog" aria-label="Central">
      <div class="ct-win">
        <nav class="ct-rail"><h2>Central</h2>${SECTIONS.map((s) => `<button class="ct-nav" data-s="${s.id}"><i style="background:${s.color}">${svg(s.id)}</i>${s.label}<span class="badge-n" id="ctn-${s.id}"></span></button>`).join('')}</nav>
        <div class="ct-main">
          <div class="ct-head"><div><h1 id="ctTitle"></h1><div class="sub" id="ctSub"></div></div>
            <div class="ct-tools"><button class="ct-btn" id="ctRefresh" title="Atualizar">↻</button><button class="ct-btn" id="ctClose" title="Fechar (Esc)">✕</button></div></div>
          <div class="ct-body" id="ctBody"></div>
        </div>
      </div>
    </div>`,
  );
  const $ = (id) => document.getElementById(id);
  const body = $('ctBody');
  const st = { section: 'hoje', agent: null, pesquisa: 'brief', poll: null, token: 0 };

  async function api(path, method = 'GET', data) {
    const r = await fetch(
      '/api/office' + path,
      method === 'GET'
        ? {}
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {}),
          },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.error || `erro ${r.status}`);
      e.down = !!j.down;
      throw e;
    }
    return j;
  }
  const toast = (m) => {
    const el = $('toast');
    if (!el) return;
    el.textContent = m;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  };
  const head = (title, sub = '') => {
    $('ctTitle').textContent = title;
    $('ctSub').textContent = sub;
  };
  const checkRow = (rowHtml, attrs, done = false) =>
    rowHtml.replace(
      '<div class="cd-row">',
      `<div class="cd-row"><button class="ct-check ${done ? 'done' : ''}" ${attrs} aria-label="Concluir">✓</button>`,
    );
  const sideBtn = (rowHtml, btn) => rowHtml.replace(/<\/div>$/, `${btn}</div>`);
  const daysUntil = (d) => (d ? Math.ceil((Date.parse(d) - Date.now()) / 86400000) : null);

  function downView(err) {
    head('Brain Office', 'o escritório não está respondendo');
    body.innerHTML = `<div class="ct-down"><b>${err.down ? 'O Brain Office está desligado' : 'Não consegui carregar'}</b>${U().esc(err.message)}<div style="margin-top:18px">${err.down ? '<button class="ct-btn primary" id="ctStart">Ligar escritório</button>' : '<button class="ct-btn" id="ctRetry">Tentar de novo</button>'}</div></div>`;
    $('ctStart') &&
      ($('ctStart').onclick = async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Ligando…';
        const r = await fetch('/api/office-start', { method: 'POST' })
          .then((x) => x.json())
          .catch(() => ({}));
        toast(r.message || 'ok');
        setTimeout(() => show(st.section), 4000);
      });
    $('ctRetry') && ($('ctRetry').onclick = () => show(st.section));
  }

  // conta Google sempre com botao de reconectar: o erro quando houver, senao a conta conectada
  const gStatus = (g) => {
    if ((g.errors || []).length) return g.errors.join(' ');
    const acc = (g.accounts || []).filter(Boolean);
    return g.connected ? 'Conectada' + (acc.length ? ': ' + acc.join(', ') : '') : 'Nenhuma conta conectada.';
  };

  /* ---------------- areas ---------------- */
  const VIEWS = {
    async hoje() {
      const [{ hoje }, google] = await Promise.all([
        api('/hoje?refresh=1'),
        fetch('/api/google?days=1')
          .then((r) => r.json())
          .catch(() => ({ events: [], tasks: [], errors: [] })),
      ]);
      // o "Hoje" do escritorio fica sem eventos (sem aviso) quando o token do Google expira: usa os
      // eventos e o erro reais do /api/google
      if ((google.events || []).length) hoje.planner.events = google.events;
      const r = window.wyCards._render.hoje(hoje);
      const u = U();
      head('Hoje', r.sub);
      const banner = `<div class="cd-grp" style="margin-bottom:10px"><div class="cd-row"><div class="main"><div class="t">Google Agenda e Tasks</div><div class="d">${u.esc(gStatus(google))}</div></div><button class="ct-mini" id="ctGReconnect">Reconectar Google</button></div></div>`;
      const gt = (google.tasks || []).filter((t) => t.due && daysUntil(t.due) <= 0);
      body.innerHTML =
        banner +
        r.html +
        (gt.length
          ? u.sec(
              'Google Tasks para hoje',
              u.grp(gt.map((t) => u.row({ t: t.title, when: 'prazo ' + u.fmtDate(t.due) }))),
            )
          : '');
      if ($('ctGReconnect'))
        $('ctGReconnect').onclick = async () => {
          const x = await fetch('/api/google/reconnect', { method: 'POST' })
            .then((y) => y.json())
            .catch(() => ({}));
          toast(x.message || 'Abri o navegador pra reconectar');
        };
    },

    async agenda() {
      const u = U();
      // Google vem direto do servidor do oculos (/api/google -> Planner Core), com o erro real: a
      // rota que o "Hoje" do escritorio usa devolvia lista vazia quando o token expirava
      const [pl, { reminders }, google] = await Promise.all([
        api('/local/planner'),
        api('/reminders'),
        fetch('/api/google')
          .then((r) => r.json())
          .catch(() => ({ events: [], tasks: [], errors: ['Servidor do óculos sem resposta'] })),
      ]);
      const pend = (pl.tasks || []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      const done = (pl.tasks || []).filter((t) => t.status === 'done').slice(0, 5);
      head('Agenda', `${pend.length} tarefas pendentes`);
      const taskRow = (t, isDone) =>
        checkRow(
          u.row({
            t: t.title,
            d: (t.notes || '').split('\n')[0],
            when: t.due_at ? 'prazo ' + u.fmtDate(t.due_at) : '',
            tags: [t.due_at && daysUntil(t.due_at) < 0 && !isDone ? 'atrasada' : ''],
          }),
          `data-task="${t.id}"`,
          isDone,
        );
      const events = google.events || [];
      const gtasks = google.tasks || [];
      const gErr = `<div class="cd-grp" style="margin-bottom:10px"><div class="cd-row"><div class="main"><div class="t">Google</div><div class="d">${u.esc(gStatus(google))}</div></div><button class="ct-mini" id="ctGReconnect">Reconectar Google</button></div></div>`;
      body.innerHTML =
        gErr +
        `<div class="ct-add"><input id="ctTask" placeholder="Nova tarefa…" maxlength="200"><input id="ctTaskDate" type="date"><button class="ct-btn primary" id="ctTaskAdd">Adicionar</button></div>` +
        `<div class="ct-cols"><div>${u.sec(
          'Pendentes',
          u.grp(
            pend.map((t) => taskRow(t, false)),
            40,
          ),
          String(pend.length),
        )}${
          done.length
            ? u.sec(
                'Concluídas',
                u.grp(
                  done.map((t) => taskRow(t, true)),
                  5,
                ),
              )
            : ''
        }</div>` +
        `<div>${u.sec('Google Agenda · 7 dias', events.length ? `<div class="cd-tl">${events.map((e) => u.row({ when: u.fmtDate(e.start), t: e.title, d: [e.location, e.calendarName].filter(Boolean).join(' · ') })).join('')}</div>` : `<div class="cd-grp"><div class="cd-empty">${google.errors && google.errors.length ? 'Indisponível: veja o aviso acima.' : 'Nada marcado.'}</div></div>`, events.length ? String(events.length) : '')}` +
        `${u.sec(
          'Google Tasks',
          gtasks.length
            ? u.grp(
                gtasks.map((t) =>
                  u.row({
                    t: t.title,
                    d: (t.notes || '').split('\n')[0],
                    when: t.due ? 'prazo ' + u.fmtDate(t.due) : '',
                    tags: [t.due && daysUntil(t.due) < 0 ? 'atrasada' : ''],
                  }),
                ),
                30,
              )
            : `<div class="cd-grp"><div class="cd-empty">${google.errors && google.errors.length ? 'Indisponível: veja o aviso acima.' : 'Nenhuma tarefa no Google Tasks.'}</div></div>`,
          gtasks.length ? String(gtasks.length) : '',
        )}` +
        `${u.sec(
          'Lembretes do escritório',
          u.grp(
            (reminders || []).map((r) =>
              u.row({
                t: r.text,
                d: r.agent,
                tags: [r.active ? 'ativo' : 'pausado'],
                when: r.nextAt ? u.fmtDate(new Date(r.nextAt).toISOString()) : '',
              }),
            ),
            10,
          ),
        )}</div></div>`;
      const add = async () => {
        const title = $('ctTask').value.trim();
        if (!title) return;
        const dueAt = $('ctTaskDate').value
          ? new Date($('ctTaskDate').value + 'T12:00:00').toISOString()
          : null;
        await api('/local/planner/tasks', 'POST', { title, dueAt })
          .then(() => {
            toast('Tarefa criada');
            VIEWS.agenda();
          })
          .catch((e) => toast(e.message));
      };
      $('ctTaskAdd').onclick = add;
      if ($('ctGReconnect'))
        $('ctGReconnect').onclick = async () => {
          const r = await fetch('/api/google/reconnect', { method: 'POST' })
            .then((x) => x.json())
            .catch(() => ({}));
          toast(r.message || 'Abri o navegador pra reconectar');
        };
      $('ctTask').onkeydown = (e) => {
        if (e.key === 'Enter') add();
      };
      body.querySelectorAll('[data-task]').forEach(
        (b) =>
          (b.onclick = async () => {
            const isDone = b.classList.contains('done');
            b.classList.toggle('done');
            await api(`/local/planner/tasks/${b.dataset.task}`, 'PATCH', {
              status: isDone ? 'pending' : 'done',
            })
              .then(() => {
                toast(isDone ? 'Reaberta' : 'Concluída');
                setTimeout(VIEWS.agenda, 450);
              })
              .catch((e) => {
                b.classList.toggle('done');
                toast(e.message);
              });
          }),
      );
    },

    async faculdade() {
      const u = U();
      const [pl, { hoje }] = await Promise.all([api('/local/planner'), api('/hoje')]);
      const subjects = pl.subjects || [],
        topics = (pl.topics || []).filter((t) => !t.done);
      head('Faculdade', `${subjects.length} disciplinas · ${topics.length} entregas abertas`);
      const exams = hoje.planner.exams || [];
      body.innerHTML =
        (exams.length
          ? u.stats(
              exams
                .slice(0, 4)
                .map((e) => ({ v: e.daysLeft + ' dias', l: 'prova de ' + e.subject })),
            )
          : '') +
        `<div class="ct-cols"><div>${u.sec(
          'Disciplinas',
          subjects.length
            ? u.grp(
                subjects.map((s) =>
                  u.row({
                    t: s.name,
                    tags: [s.exam_date ? 'prova ' + u.fmtDate(s.exam_date) : ''],
                    bar: Number(s.progress) || 0,
                  }),
                ),
                30,
              )
            : '<div class="cd-grp"><div class="cd-empty">Nenhuma disciplina cadastrada.<br>Peça ao setor Faculdade ou ao Jarvis.</div></div>',
        )}</div>` +
        `<div>${u.sec(
          'Entregas e tópicos',
          topics.length
            ? u.grp(
                topics.map((t) =>
                  u.row({ t: t.title, when: t.due_at ? 'entrega ' + u.fmtDate(t.due_at) : '' }),
                ),
                30,
              )
            : '<div class="cd-grp"><div class="cd-empty">Nada pendente.</div></div>',
        )}${u.sec('Estudando agora', u.grp((hoje.planner.studyDue || []).map((s) => u.row({ t: s.title, when: u.fmtDate(s.dueAt) }))))}</div></div>`;
    },

    async clientes() {
      const u = U();
      const pl = await api('/local/planner');
      const clients = (pl.clients || []).filter((c) => c.stage !== 'closed');
      const inbox = (pl.messages || []).filter((m) => !m.handled);
      const pipeline = clients.reduce((s, c) => s + (Number(c.value) || 0), 0);
      head('Clientes', `${clients.length} ativos · inbox ${inbox.length}`);
      body.innerHTML =
        u.stats([
          { v: clients.length, l: 'clientes ativos' },
          { v: 'R$ ' + u.fmtN(pipeline), l: 'no pipeline' },
          { v: inbox.length, l: 'e-mails sem tratar' },
        ]) +
        `<div class="ct-cols"><div>${u.sec(
          'Pipeline',
          u.grp(
            clients.map((c) =>
              u.row({
                t: c.name,
                d: c.next_action ? 'Próximo: ' + c.next_action : '',
                tags: [c.stage, c.next_action_at ? u.fmtDate(c.next_action_at) : 'sem data'],
                side: c.value ? 'R$ ' + u.fmtN(Number(c.value)) : '',
              }),
            ),
            30,
          ),
        )}</div>` +
        `<div>${u.sec(
          'Inbox',
          inbox.length
            ? u.grp(
                inbox.map((m) =>
                  sideBtn(
                    u.row({
                      t: m.subject || '(sem assunto)',
                      d: (m.from_name || '') + (m.snippet ? ' — ' + m.snippet : ''),
                      when: u.fmtDate(m.received_at),
                    }),
                    `<button class="ct-mini" data-msg="${u.esc(m.id)}">Tratado</button>`,
                  ),
                ),
                15,
              )
            : '<div class="cd-grp"><div class="cd-empty">Inbox zerada.</div></div>',
        )}</div></div>`;
      body.querySelectorAll('[data-msg]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            await api(`/local/planner/messages/${encodeURIComponent(b.dataset.msg)}`, 'PATCH', {
              handled: true,
            })
              .then(() => {
                toast('Marcado como tratado');
                VIEWS.clientes();
              })
              .catch((e) => {
                b.disabled = false;
                toast(e.message);
              });
          }),
      );
    },

    async projetos() {
      const u = U();
      const [pl, build] = await Promise.all([
        api('/local/planner'),
        api('/local/brain/build').catch(() => []),
      ]);
      const builds = (Array.isArray(build) ? build : []).filter((b) => b.status !== 'DONE');
      head(
        'Projetos',
        `${(pl.projects || []).length} no planner · ${builds.length} ideias e builds`,
      );
      const tasksOf = (b) => (Array.isArray(b.tasks) ? b.tasks : []);
      body.innerHTML =
        `<div class="ct-cols"><div>${u.sec(
          'Seus projetos',
          u.grp(
            (pl.projects || []).map((p) =>
              u.row({
                t: p.name,
                d: p.goal,
                bar: Number(p.progress) || 0,
                side: (Number(p.progress) || 0) + '%',
              }),
            ),
            20,
          ),
        )}</div>` +
        `<div>${u.sec(
          'Construa com isto (Current Brain)',
          u.grp(
            builds.map((b) => {
              const t = tasksOf(b);
              const d = t.filter((x) => x.status === 'DONE').length;
              return u.row({
                t: b.name,
                d: b.goal || b.reason,
                tags: [b.status, b.difficulty, b.estimated_time],
                bar: t.length ? (100 * d) / t.length : undefined,
                side: t.length ? `${d}/${t.length}` : '',
              });
            }),
            12,
          ),
        )}</div></div>`;
    },

    async pesquisa() {
      const u = U();
      const tabs = {
        brief: 'Brief',
        now: 'Agora',
        learn: 'Aprender',
        trending: 'GitHub',
        catchup: 'Catch-up',
        knowledge: 'Conhecimento',
        frontier: 'Fronteira',
      };
      const view = st.pesquisa;
      const data = await api('/local/brain/' + view);
      head('Pesquisa & Tec', 'Current Brain');
      let html = '';
      const content = (list) =>
        u.grp(
          (list || []).map((c) =>
            u.row({
              t: c.title,
              d: c.why_it_matters || c.summary,
              url: c.url,
              tags: [c.priority, c.category, c.read_minutes ? c.read_minutes + ' min' : ''],
            }),
          ),
          25,
        );
      if (view === 'brief') {
        const b = data || {};
        const blocks = Array.isArray(b.blocks) ? b.blocks : [];
        html =
          (b.headline
            ? u.hero(String(b.headline).replace(/\\n/g, ' ').split('\n')[0], b.intro)
            : '<div class="cd-grp"><div class="cd-empty">Sem brief ainda.</div></div>') +
          (b.next_move && b.next_move.title
            ? u.sec(
                'Próximo passo',
                u.grp([u.row({ t: b.next_move.title, d: b.next_move.action })]),
              )
            : '') +
          u.sec(
            'Blocos do dia',
            u.grp(blocks.map((x) => u.row({ t: x.title, d: x.meta, tags: [x.label] }))),
            b.date ? u.fmtDate(b.date) : '',
          );
      } else if (view === 'now' || view === 'frontier') html = content(data);
      else if (view === 'learn')
        html = u.grp(
          (data || []).map((l) =>
            u.row({
              t: l.title,
              d: l.why,
              tags: [l.track, l.minutes_total ? l.minutes_total + ' min' : ''],
              bar: Number(l.progress) || 0,
              side: `${l.steps_done || 0}/${l.stepCount || '?'}`,
              sideLabel: 'passos',
            }),
          ),
          30,
        );
      else if (view === 'trending')
        html = u.grp(
          (data || []).map((r) =>
            u.row({
              t: r.full_name,
              url: r.url,
              d: r.why_it_matters || r.description,
              tags: [
                r.language,
                r.trending_gain
                  ? `+${u.fmtN(r.trending_gain)} ${r.trending_period === 'weekly' ? 'na semana' : 'hoje'}`
                  : '',
              ],
              side: '★ ' + u.fmtN(r.stars),
            }),
          ),
          30,
        );
      else if (view === 'catchup')
        html = `<div class="cd-tl">${(data || [])
          .filter((m) => m.state !== 'done')
          .slice(0, 40)
          .map((m) =>
            u.row({
              when: u.fmtDate(m.happened_at) + ' · ' + m.topic,
              t: m.title,
              d: m.why,
              tags: [m.importance],
            }),
          )
          .join('')}</div>`;
      else if (view === 'knowledge') {
        const gaps = (data || []).filter((k) => k.gap_reason);
        html =
          (gaps.length
            ? u.sec(
                'Lacunas',
                u.grp(
                  gaps.map((k) => u.row({ t: k.name, d: k.gap_reason, tags: [k.domain] })),
                  15,
                ),
                String(gaps.length),
              )
            : '') +
          u.sec(
            'Mapa',
            u.grp(
              (data || []).map((k) =>
                u.row({
                  t: k.name,
                  d: k.next_step || k.description,
                  tags: [k.status, k.domain],
                  bar: (Number(k.confidence) || 0) * 20,
                }),
              ),
              40,
            ),
          );
      }
      body.innerHTML =
        `<div class="ct-seg">${Object.entries(tabs)
          .map(([k, l]) => `<button data-v="${k}" class="${k === view ? 'on' : ''}">${l}</button>`)
          .join('')}</div>` + html;
      body.querySelectorAll('[data-v]').forEach(
        (b) =>
          (b.onclick = () => {
            st.pesquisa = b.dataset.v;
            show('pesquisa');
          }),
      );
    },

    async vida() {
      const u = U();
      const [pl, { notes }] = await Promise.all([
        api('/local/planner'),
        api('/local/notes').catch(() => ({ notes: [] })),
      ]);
      head('Vida & Casa', 'hábitos e notas');
      const habits = pl.habits || [];
      body.innerHTML =
        `<div class="ct-cols"><div>${u.sec('Hábitos de hoje', habits.length ? u.grp(habits.map((h) => sideBtn(u.row({ t: h.name, side: `${h.current ?? 0}${h.target ? '/' + h.target : ''}`, sideLabel: h.unit, bar: h.target ? (100 * (h.current || 0)) / h.target : undefined }), `<button class="ct-mini" data-hab="${h.id}">+1</button>`))) : '<div class="cd-grp"><div class="cd-empty">Nenhum hábito.</div></div>')}</div>` +
        `<div>${u.sec(
          'Notas',
          (notes || []).length
            ? u.grp(
                notes.map((n) =>
                  sideBtn(
                    u.row({ t: n.title, d: n.path, when: u.fmtDate(n.updatedAt) }),
                    `<button class="ct-mini" data-note="${u.esc(n.path)}">Abrir</button>`,
                  ),
                ),
                30,
              )
            : '<div class="cd-grp"><div class="cd-empty">Sem notas.</div></div>',
        )}<div id="ctNote"></div></div></div>`;
      body.querySelectorAll('[data-hab]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            await api(`/local/planner/habits/${b.dataset.hab}`, 'PATCH', { delta: 1 })
              .then(() => VIEWS.vida())
              .catch((e) => {
                b.disabled = false;
                toast(e.message);
              });
          }),
      );
      body.querySelectorAll('[data-note]').forEach(
        (b) =>
          (b.onclick = async () => {
            const n = await api('/local/note?path=' + encodeURIComponent(b.dataset.note)).catch(
              (e) => ({ content: e.message }),
            );
            $('ctNote').innerHTML = u.sec(
              b.dataset.note,
              `<div class="ct-note">${u.esc(n.content ?? n.markdown ?? JSON.stringify(n))}</div>`,
            );
            $('ctNote').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }),
      );
    },

    async agentes() {
      const u = U();
      const { agents } = await api('/agents');
      const list = agents.filter((a) => a.active);
      if (!st.agent || !list.find((a) => a.key === st.agent))
        st.agent = (list.find((a) => a.key === 'setor-agenda') || list[0] || {}).key;
      const cur = list.find((a) => a.key === st.agent) || {};
      head(
        'Agentes',
        `${cur.label || ''} · ${cur.status || ''}${cur.autonomy ? ' · ' + cur.autonomy : ''}`,
      );
      const { entries } = await api(`/agents/${st.agent}/chat?limit=60`);
      // os avisos automaticos ("Tarefa atrasada: ...") se repetem a cada ciclo e afogam a conversa
      const all = (entries || []).filter((e) => e.role !== 'tool');
      const reminderIdx = all.map((e, i) => (e.role === 'lembrete' ? i : -1)).filter((i) => i >= 0);
      const keepReminders = new Set(reminderIdx.slice(-3));
      const hidden = reminderIdx.length - keepReminders.size;
      const msgs =
        (hidden > 0
          ? `<div class="ct-msg sys">${hidden} avisos automáticos anteriores ocultos</div>`
          : '') +
        all
          .filter((e, i) => e.role !== 'lembrete' || keepReminders.has(i))
          .map((e) => {
            const cls =
              e.role === 'user'
                ? 'user'
                : e.role === 'agent'
                  ? 'agent'
                  : e.role === 'error'
                    ? 'err'
                    : 'sys';
            const time = new Date(e.ts).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            return `<div class="ct-msg ${cls}">${u.esc(e.text)}<small>${e.role === 'peer_in' ? 'de ' + u.esc(e.from || '') + ' · ' : ''}${time}</small></div>`;
          })
          .join('');
      body.innerHTML =
        `<div class="ct-agents">${list.map((a) => `<button class="ct-agent ${a.key === st.agent ? 'on' : ''}" data-ag="${a.key}"><span class="st ${a.status}"></span>${u.esc(a.label)}</button>`).join('')}</div>` +
        `<div class="ct-chat" id="ctChat">${msgs || '<div class="ct-msg sys">Sem conversa ainda.</div>'}${cur.status === 'trabalhando' ? `<div class="ct-typing">${u.esc(cur.label)} está trabalhando${cur.activity ? ': ' + u.esc(cur.activity) : '…'}</div>` : ''}</div>` +
        `<div class="ct-add" style="position:sticky;bottom:0;padding:8px 0;background:inherit"><input id="ctSay" placeholder="Mensagem para ${u.esc(cur.label || 'o setor')}…" maxlength="4000"><button class="ct-btn primary" id="ctSend">Enviar</button></div>`;
      body.scrollTop = body.scrollHeight;
      body.querySelectorAll('[data-ag]').forEach(
        (b) =>
          (b.onclick = () => {
            st.agent = b.dataset.ag;
            show('agentes');
          }),
      );
      const send = async () => {
        const text = $('ctSay').value.trim();
        if (!text) return;
        $('ctSend').disabled = true;
        await api(`/agents/${st.agent}/messages`, 'POST', { text })
          .then(() => {
            toast('Enviado');
            setTimeout(VIEWS.agentes, 800);
          })
          .catch((e) => {
            $('ctSend').disabled = false;
            toast(e.message);
          });
      };
      $('ctSend').onclick = send;
      $('ctSay').onkeydown = (e) => {
        if (e.key === 'Enter') send();
      };
      $('ctSay').focus({ preventScroll: true });
    },

    async mural() {
      const u = U();
      const [{ posts }, { reminders }] = await Promise.all([
        api('/board?limit=60'),
        api('/reminders'),
      ]);
      head('Mural', `${posts.length} publicações`);
      const label = {
        pergunta: 'pergunta',
        resposta: 'resposta',
        aviso: 'aviso',
        pedido: 'pedido',
        decisao: 'decisão',
        brief: 'brief',
        lembrete: 'lembrete',
        recepcao: 'recepção',
      };
      body.innerHTML =
        `<div class="ct-cols"><div>${u.sec(
          'Publicações',
          u.grp(
            posts
              .slice()
              .reverse()
              .map((p) =>
                u.row({
                  when:
                    u.fmtDate(new Date(p.ts).toISOString()) +
                    ' · ' +
                    p.from +
                    (p.to ? ' → ' + p.to : ''),
                  t: p.title || String(p.text).split('\n')[0].slice(0, 120),
                  d: p.title ? String(p.text).replace(/\*\*/g, '').slice(0, 260) : '',
                  tags: [label[p.kind] || p.kind],
                }),
              ),
            40,
          ),
        )}</div>` +
        `<div>${u.sec('Lembretes', u.grp((reminders || []).map((r) => u.row({ t: r.text, d: r.agent, tags: [r.active ? 'ativo' : 'pausado', r.everyMinutes ? `a cada ${r.everyMinutes} min` : ''] }))))}</div></div>`;
    },
  };

  /* ---------------- navegacao ---------------- */
  async function show(section) {
    st.section = section;
    clearInterval(st.poll);
    const token = ++st.token;
    document
      .querySelectorAll('.ct-nav')
      .forEach((b) => b.classList.toggle('active', b.dataset.s === section));
    body.innerHTML = '<div class="cd-empty">Carregando…</div>';
    try {
      await VIEWS[section]();
      if (token !== st.token) return;
    } catch (e) {
      if (token === st.token) downView(e);
      return;
    }
    // agentes: acompanha a resposta chegando enquanto o setor trabalha
    if (section === 'agentes')
      st.poll = setInterval(async () => {
        if (
          !$('ct').classList.contains('open') ||
          st.section !== 'agentes' ||
          (document.activeElement?.id === 'ctSay' && $('ctSay').value)
        )
          return;
        const { agents } = await api('/agents').catch(() => ({ agents: [] }));
        const a = agents.find((x) => x.key === st.agent);
        if (a && (a.status !== 'ocioso' || st.lastStatus !== a.status)) {
          st.lastStatus = a.status;
          VIEWS.agentes().catch(() => {});
        }
      }, 3000);
  }

  function open(section, agent) {
    if (section === 'fechar') return close();
    if (agent) st.agent = agent.startsWith('setor-') ? agent : 'setor-' + agent;
    $('ct').classList.add('open');
    show(SECTIONS.some((s) => s.id === section) ? section : st.section);
  }
  function close() {
    $('ct').classList.remove('open');
    clearInterval(st.poll);
  }

  document.querySelectorAll('.ct-nav').forEach((b) => (b.onclick = () => show(b.dataset.s)));
  $('ctClose').onclick = close;
  $('ctRefresh').onclick = () => show(st.section);
  $('ct').addEventListener('click', (e) => {
    if (e.target.id === 'ct') close();
  });
  addEventListener(
    'keydown',
    (e) => {
      if (
        e.key === 'Escape' &&
        $('ct').classList.contains('open') &&
        !document.getElementById('pn')?.classList.contains('open')
      ) {
        e.stopImmediatePropagation();
        close();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('ct').classList.contains('open') ? close() : open(st.section);
      }
    },
    true,
  );

  window.wyCentral = { open, close, show };
})();
