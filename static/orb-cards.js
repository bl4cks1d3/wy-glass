// Paineis estruturados do orb: resultado de ferramentas de dados (MCPs, ler_dados_da_vida,
// escritorio) e paineis montados pelo agente (mostrar_na_tela). orb.html chama
// wyCards.fromTool(evento live_tool) e wyCards.fromAgent(card).
(() => {
  const SRC = {
    brain: { label: 'Current Brain', color: '#bf5af2' },
    planner: { label: 'Planner Life', color: '#30d158' },
    escritorio: { label: 'Brain Office', color: '#ff9f0a' },
    vida: { label: 'Sua vida', color: '#0a84ff' },
    jarvis: { label: 'Jarvis', color: '#ff375f' },
    mcp: { label: 'MCP', color: '#64d2ff' },
  };
  // ferramentas que so gravam algo: o feed de atividade ja registra, painel seria ruido
  const WRITE_TOOLS = new Set([
    'add_link',
    'create_goal',
    'update_goal',
    'record_feedback',
    'suggest_project',
    'save_record',
    'import_records',
    'save_collection',
    'save_automation',
    'annotate_repo',
    'track_repos',
  ]);
  const ESCRITORIO_VISUAL = new Set([
    'hoje',
    'status',
    'mural',
    'lembretes',
    'pendencias',
    'perguntar',
    'ultima_resposta',
  ]);

  /* ---------- helpers ---------- */
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const tryJSON = (s) => {
    if (typeof s !== 'string') return s;
    const t = s.trim();
    if (!/^[[{]/.test(t)) return s;
    try {
      return JSON.parse(t);
    } catch {
      return s;
    }
  };
  const fmtN = (n) =>
    typeof n === 'number'
      ? n >= 10000
        ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.', ',') + ' mil'
        : n.toLocaleString('pt-BR')
      : esc(n);
  const fmtDate = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return esc(v);
    const hasTime = /T\d\d:\d\d/.test(String(v)) && !/T00:00(:00)?(\.000)?Z?$/.test(String(v));
    return (
      d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) +
      (hasTime ? ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '')
    );
  };
  const humanKey = (k) =>
    ({
      now: 'Agora',
      learn: 'Aprender',
      build: 'Construir',
      frontier: 'Fronteira',
      total: 'Total',
      collected: 'Coletados',
      pending: 'Pendentes',
      minutes: 'Minutos',
      inboxSemTratar: 'Inbox sem tratar',
      pendentesDeTriagem: 'Para triagem',
      pipelineValue: 'Pipeline',
      papersQueued: 'Papers na fila',
      inboxUnhandled: 'Inbox sem tratar',
      records: 'Registros',
    })[k] ||
    String(k)
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
  const TAG_PT = {
    pending: 'pendente',
    in_progress: 'em andamento',
    done: 'feito',
    cancelled: 'cancelado',
    todo: 'a fazer',
    BUILDING: 'construindo',
    PLANNED: 'planejado',
    IDEA: 'ideia',
    PAUSED: 'pausado',
    APPLIED: 'aplicado',
    LEARNING: 'aprendendo',
    KNOWN: 'conhece',
    GAP: 'lacuna',
    essential: 'essencial',
    important: 'importante',
    UNREAD: 'não lido',
    ocioso: 'ocioso',
    trabalhando: 'trabalhando',
    aguardando_aprovacao: 'aguardando aprovação',
    lead: 'lead',
    closed: 'fechado',
    rising: 'subindo',
    'trending-daily': 'em alta hoje',
  };
  const tagText = (t) => TAG_PT[t] ?? TAG_PT[String(t).toLowerCase()] ?? String(t);
  const tagCls = (t) => {
    const s = String(t).toUpperCase();
    if (/^P0$|OVERDUE|ATRASAD|ERRO|FAIL|ESSENTIAL|ALTA/.test(s)) return 'hot';
    if (/^P1$|PENDING|PENDENTE|BUILDING|TRABALHANDO|AGUARDANDO|IMPORTANT|MEDIA/.test(s))
      return 'warm';
    if (/DONE|APPLIED|ACTIVE|ATIV|OK|CONCLU|OCIOSO|MASTER/.test(s)) return 'ok';
    if (/^P2$|INFO|LEARN|TUTORIAL|NEW|PLANNED/.test(s)) return 'info';
    return '';
  };

  const row = (o) => {
    const t = o.url
      ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.t)}</a>`
      : esc(o.t);
    const tags = (o.tags || [])
      .filter((x) => x !== undefined && x !== null && x !== '')
      .map((x) => `<span class="cd-tag ${tagCls(x)}">${esc(tagText(x))}</span>`)
      .join('');
    const bar =
      typeof o.bar === 'number' && isFinite(o.bar)
        ? `<div class="cd-bar"><i style="width:${Math.max(2, Math.min(100, o.bar))}%"></i></div>`
        : '';
    const side =
      o.side !== undefined && o.side !== null && o.side !== ''
        ? `<div class="side"><b>${o.side}</b>${o.sideLabel ? esc(o.sideLabel) : ''}</div>`
        : '';
    const when = o.when ? `<div class="cd-when">${esc(o.when)}</div>` : '';
    return `<div class="cd-row"><div class="main">${when}<div class="t">${t || '—'}</div>${o.d ? `<div class="d">${esc(o.d)}</div>` : ''}${tags ? `<div class="cd-meta">${tags}</div>` : ''}${bar}</div>${side}</div>`;
  };
  const grp = (rows, limit = 12, cls = '') => {
    if (!rows.length) return `<div class="cd-grp"><div class="cd-empty">Nada aqui.</div></div>`;
    const more =
      rows.length > limit ? `<div class="cd-more">+ ${rows.length - limit} itens</div>` : '';
    return `<div class="cd-grp ${cls}">${rows.slice(0, limit).join('')}${more}</div>`;
  };
  const sec = (title, html, right = '') =>
    html
      ? `<div class="cd-sec"><div class="cd-sec-t"><span>${esc(title)}</span><span>${esc(right)}</span></div>${html}</div>`
      : '';
  const stats = (list) => {
    const items = list.filter((x) => x.v !== undefined && x.v !== null && x.v !== '');
    return items.length
      ? `<div class="cd-stats">${items.map((x) => `<div class="cd-stat"><b>${typeof x.v === 'number' ? fmtN(x.v) : esc(x.v)}</b><span>${esc(x.l)}</span></div>`).join('')}</div>`
      : '';
  };
  const chips = (list, dim = false) =>
    list && list.length
      ? `<div class="cd-chips">${list.map((c) => `<span class="cd-chip ${dim ? 'dim' : ''}">${esc(typeof c === 'object' ? c.name || c.label || c.topic || JSON.stringify(c) : c)}</span>`).join('')}</div>`
      : '';
  const table = (cols, rows) =>
    `<div class="cd-grp cd-scroll-x"><table class="cd-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const hero = (title, sub) =>
    title
      ? `<div class="cd-hero"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`
      : '';
  const textBlock = (s) => {
    const str = String(s ?? '').trim();
    if (!str) return `<div class="cd-empty">Sem conteúdo.</div>`;
    const lines = str.split('\n').filter((l) => l.trim());
    // linhas no formato "chave: valor" / "[data] ..." / "- item" viram lista
    if (
      lines.length > 2 &&
      lines.filter((l) => /^(\s*[-•]|\[|\w[\w-]* = |\w[\w-]*:)/.test(l)).length >=
        lines.length * 0.6
    ) {
      return grp(
        lines.map((l) => {
          const m = l
            .replace(/^\s*[-•]\s*/, '')
            .match(/^(\[[^\]]+\]\s*)?(.+?)(?::\s+|\s+=\s+)(.+)$/);
          return m
            ? row({ when: m[1] ? m[1].replace(/[[\]]/g, '').trim() : '', t: m[2], d: m[3] })
            : row({ t: l.replace(/^\s*[-•]\s*/, '') });
        }),
        40,
      );
    }
    return `<div class="cd-text">${str
      .split(/\n\s*\n/)
      .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('')}</div>`;
  };

  /* ---------- generico: qualquer JSON vira algo legivel ---------- */
  const TITLE_KEYS = [
    'titulo',
    'title',
    'nome',
    'name',
    'label',
    'fullName',
    'topic',
    'texto',
    'text',
  ];
  const DESC_KEYS = [
    'detalhe',
    'description',
    'whyItMatters',
    'why',
    'porque',
    'summary',
    'objetivo',
    'goal',
    'nextStep',
    'proximaAcao',
    'intro',
    'role',
    'url',
  ];
  const TAG_KEYS = [
    'priority',
    'prioridade',
    'status',
    'etapa',
    'stage',
    'category',
    'area',
    'language',
    'importance',
    'tag',
    'via',
    'state',
  ];
  const DATE_KEYS = [
    'prazo',
    'due_at',
    'dueAt',
    'date',
    'quando',
    'happenedAt',
    'start',
    'nextAt',
    'publishedAt',
    'examDate',
    'prova',
  ];
  const PROG_KEYS = ['progresso', 'progress', 'pct'];
  const pick = (o, keys) => {
    for (const k of keys)
      if (o[k] !== undefined && o[k] !== null && o[k] !== '' && typeof o[k] !== 'object')
        return [k, o[k]];
    return [null, null];
  };
  function autoRow(o) {
    if (typeof o !== 'object' || o === null) return row({ t: String(o) });
    const [tk, t] = pick(o, TITLE_KEYS);
    const [dk, d] = pick(
      o,
      DESC_KEYS.filter((k) => k !== tk),
    );
    const tags = TAG_KEYS.filter((k) => o[k] && typeof o[k] !== 'object').map((k) => o[k]);
    const [, when] = pick(o, DATE_KEYS);
    const [, prog] = pick(o, PROG_KEYS);
    const nums = Object.entries(o).filter(
      ([k, v]) => typeof v === 'number' && !PROG_KEYS.includes(k),
    );
    const side = nums[0] ? fmtN(nums[0][1]) : '';
    return row({
      t: t ?? Object.values(o).find((v) => typeof v === 'string') ?? 'item',
      d: dk === 'url' ? '' : d,
      url: o.url,
      tags,
      when: when ? fmtDate(when) : '',
      bar: typeof prog === 'number' ? prog : undefined,
      side,
      sideLabel: nums[0] ? humanKey(nums[0][0]) : '',
    });
  }
  function generic(d) {
    d = tryJSON(d);
    if (typeof d === 'string') return textBlock(d);
    if (Array.isArray(d))
      return d.length && typeof d[0] !== 'object' ? chips(d) : grp(d.map(autoRow), 25);
    if (d && typeof d === 'object') {
      const prims = Object.entries(d).filter(([, v]) => v === null || typeof v !== 'object');
      const nested = Object.entries(d).filter(([, v]) => v && typeof v === 'object');
      const numStats = prims
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => ({ v, l: humanKey(k) }));
      const strRows = prims
        .filter(([, v]) => typeof v === 'string' || typeof v === 'boolean')
        .map(([k, v]) => row({ t: humanKey(k), d: String(v) }));
      return (
        stats(numStats) +
        (strRows.length ? `<div class="cd-sec">${grp(strRows, 20)}</div>` : '') +
        nested
          .map(([k, v]) =>
            sec(
              humanKey(k),
              Array.isArray(v)
                ? v.length && typeof v[0] !== 'object'
                  ? chips(v)
                  : grp(v.map(autoRow), 10)
                : generic(v),
              Array.isArray(v) ? String(v.length) : '',
            ),
          )
          .join('')
      );
    }
    return textBlock(String(d));
  }

  /* ---------- renderizadores por fonte ---------- */
  const priorityRank = (p) => ({ P0: 0, P1: 1, P2: 2, P3: 3 })[p] ?? 9;
  const contentRows = (list) =>
    list
      .slice()
      .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
      .map((c) =>
        row({
          t: c.title,
          d: c.whyItMatters || c.summary,
          url: c.url,
          tags: [c.priority, c.category, c.area, c.source],
        }),
      );

  const BRAIN = {
    get_context(d) {
      const p = d.profile || {},
        pu = d.pulse || {};
      const gaps = (d.knowledge || []).filter((k) => k.gapReason);
      return {
        title: p.name ? `Contexto de ${p.name}` : 'Contexto',
        sub: p.role,
        html:
          stats([
            { v: pu.total, l: 'itens hoje' },
            { v: pu.learn, l: 'para aprender' },
            { v: pu.build, l: 'para construir' },
            { v: pu.pending, l: 'na triagem' },
          ]) +
          sec('Construindo', chips(p.building)) +
          (gaps.length
            ? sec(
                'Lacunas de conhecimento',
                grp(
                  gaps.map((k) => row({ t: k.name, d: k.gapReason, tags: [k.domain] })),
                  6,
                ),
                String(gaps.length),
              )
            : '') +
          sec(
            'Mapa de conhecimento',
            grp(
              (d.knowledge || []).map((k) =>
                row({
                  t: k.name,
                  d: k.nextStep,
                  tags: [k.status, k.domain],
                  bar: (k.confidence || 0) * 20,
                }),
              ),
              8,
            ),
            String((d.knowledge || []).length),
          ) +
          sec(
            'Projetos',
            grp(
              (d.projects || []).map((pr) =>
                row({ t: pr.name, d: pr.description || pr.why, tags: [pr.status] }),
              ),
              6,
            ),
          ) +
          sec('Tecnologias', chips(p.technologies, true)),
      };
    },
    list_trending_repos: (d) => ({
      title: 'GitHub em alta',
      sub: `${d.length} repositórios`,
      html: grp(
        d
          .slice()
          .sort((a, b) => (b.gained7d || 0) - (a.gained7d || 0))
          .map((r) =>
            row({
              t: r.fullName,
              url: r.url,
              d: r.whyItMatters || r.description,
              tags: [r.language, r.gained7d ? `+${fmtN(r.gained7d)} em 7d` : '', r.via],
              side: r.stars !== undefined ? '★ ' + fmtN(r.stars) : '',
            }),
          ),
        15,
      ),
    }),
    list_content: (d) => ({
      title: 'Conteúdo analisado',
      sub: `${d.length} itens`,
      html: grp(contentRows(d), 15),
    }),
    search: (d, a) => ({
      title: `Busca: ${a.q || a.query || ''}`,
      html: Array.isArray(d) ? grp(contentRows(d), 15) : generic(d),
    }),
    get_content: (d) => ({
      title: d.title || 'Conteúdo',
      sub: d.source,
      html:
        hero(d.whyItMatters, d.summary) +
        generic(
          Object.fromEntries(
            Object.entries(d).filter(
              ([k]) => !['title', 'whyItMatters', 'summary', 'id'].includes(k),
            ),
          ),
        ),
    }),
    list_goals: (d) => ({
      title: 'Metas',
      sub: `${d.length} metas`,
      html: d.length
        ? grp(
            d.map((g) =>
              row({
                t: g.text || g.title,
                d: g.note || g.plan,
                tags: [g.status],
                when: fmtDate(g.createdAt),
              }),
            ),
          )
        : `<div class="cd-empty">Nenhuma meta cadastrada ainda.<br>Diga “quero aprender…” que o Jarvis cria.</div>`,
    }),
    list_milestones(d) {
      const prog = (d.progress || [])
        .slice()
        .sort((a, b) => b.essential - b.essentialDone - (a.essential - a.essentialDone));
      const todo = (d.milestones || [])
        .filter((m) => m.state !== 'done')
        .sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt)));
      return {
        title: 'O que você perdeu',
        sub: 'Marcos por tecnologia',
        html:
          sec(
            'Em dia por tópico',
            grp(
              prog.map((p) =>
                row({
                  t: p.topic,
                  side: `${p.done}/${p.total}`,
                  bar: p.pct,
                  tags: [
                    p.essential - p.essentialDone
                      ? `${p.essential - p.essentialDone} essenciais faltando`
                      : '',
                  ],
                }),
              ),
              8,
            ),
          ) +
          sec(
            'Linha do tempo',
            `<div class="cd-tl">${todo
              .slice(0, 12)
              .map((m) =>
                row({
                  when: fmtDate(m.happenedAt) + ' · ' + m.topic,
                  t: m.title,
                  tags: [m.importance],
                }),
              )
              .join('')}</div>`,
            String(todo.length),
          ),
      };
    },
    list_creator_posts: (d) => ({
      title: 'Quem você segue',
      html: d.length
        ? grp(
            d.map((p) =>
              row({
                t: p.title,
                d: p.creator || p.creatorName,
                url: p.url,
                when: fmtDate(p.publishedAt),
              }),
            ),
            15,
          )
        : `<div class="cd-empty">Nenhum post recente.</div>`,
    }),
  };

  const PLANNER = {
    list_collections: (d) => ({
      title: 'Coleções',
      sub: `${d.length} coleções`,
      html: grp(
        d.map((c) =>
          row({
            t: c.label || c.name,
            d: c.description,
            side: fmtN(c.records ?? 0),
            sideLabel: 'registros',
            tags: (c.fields || []).slice(0, 4).map((f) => f.label || f.name),
          }),
        ),
      ),
    }),
    list_records(d, a) {
      const recs = Array.isArray(d) ? d : d.records || d.items || [];
      const flat = recs.map((r) => ({
        ...(r.data || {}),
        ...Object.fromEntries(
          Object.entries(r).filter(([k]) => !['data', 'id', 'collectionId'].includes(k)),
        ),
      }));
      const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))]
        .filter((k) => !/^(createdAt|updatedAt)$/.test(k))
        .slice(0, 5);
      return {
        title: a.collection ? `Registros · ${a.collection}` : 'Registros',
        sub: `${recs.length} registros`,
        html: recs.length
          ? table(
              cols.map(humanKey),
              flat.map((r) =>
                cols.map((c) => (typeof r[c] === 'object' ? JSON.stringify(r[c]) : (r[c] ?? ''))),
              ),
            )
          : `<div class="cd-empty">Coleção vazia.</div>`,
      };
    },
    list_automations: (d) => ({
      title: 'Automações',
      html: grp(
        (Array.isArray(d) ? d : d.automations || []).map((x) =>
          row({
            t: x.name,
            d: x.description,
            tags: [x.active ? 'ativa' : 'rascunho', x.lastStatus || x.last_status],
          }),
        ),
      ),
    }),
  };

  function vida(d, a) {
    const cb = d.currentBrain || {};
    const brief = cb.brief || {};
    const fac = d.faculdade || {};
    return {
      title: a.area ? `Sua vida · ${a.area}` : 'Sua vida agora',
      sub: d.agora,
      html:
        (brief.manchete
          ? hero(
              brief.manchete.split('\n')[0],
              brief.proximoPasso ? `Próximo passo: ${brief.proximoPasso.title || ''}` : brief.intro,
            )
          : '') +
        stats([
          { v: (d.tarefasPendentes || []).length, l: 'tarefas pendentes' },
          { v: d.inboxSemTratar, l: 'inbox sem tratar' },
          { v: (cb.prioritarios || []).length || undefined, l: 'itens prioritários' },
        ]) +
        sec(
          'Tarefas',
          d.tarefasPendentes
            ? grp(
                d.tarefasPendentes.map((t) =>
                  row({
                    t: t.titulo,
                    tags: [t.status, t.prazo && Date.parse(t.prazo) < Date.now() ? 'atrasada' : ''],
                    when: t.prazo ? 'prazo ' + fmtDate(t.prazo) : '',
                  }),
                ),
                10,
              )
            : '',
        ) +
        sec(
          'Projetos',
          d.projetos
            ? grp(
                d.projetos.map((p) => row({ t: p.nome, d: p.objetivo, bar: p.progresso })),
                6,
              )
            : '',
        ) +
        sec(
          'Clientes',
          d.clientes
            ? grp(
                d.clientes.map((c) =>
                  row({
                    t: c.nome,
                    d: c.proximaAcao,
                    tags: [c.etapa, c.quando ? fmtDate(c.quando) : ''],
                    side: c.valor ? 'R$ ' + fmtN(c.valor) : '',
                  }),
                ),
                6,
              )
            : '',
        ) +
        sec(
          'Faculdade',
          (fac.disciplinas || []).length || (fac.entregas || []).length
            ? grp([
                ...(fac.disciplinas || []).map((x) =>
                  row({
                    t: x.nome,
                    tags: [x.prova ? 'prova ' + fmtDate(x.prova) : ''],
                    bar: x.progresso,
                  }),
                ),
                ...(fac.entregas || []).map((e) =>
                  row({ t: e.titulo, when: 'entrega ' + fmtDate(e.prazo) }),
                ),
              ])
            : '',
        ) +
        sec(
          'Hábitos',
          (d.habitos || []).length
            ? grp(
                d.habitos.map((h) =>
                  row({
                    t: h.nome,
                    side: `${h.atual ?? 0}${h.meta ? '/' + h.meta : ''}`,
                    sideLabel: h.unidade,
                    bar: h.meta ? (100 * (h.atual || 0)) / h.meta : undefined,
                  }),
                ),
              )
            : '',
        ) +
        sec(
          'Current Brain · prioridades',
          (cb.prioritarios || []).length
            ? grp(
                cb.prioritarios.map((p) => row({ t: p.titulo, d: p.porque, tags: [p.prioridade] })),
                6,
              )
            : '',
        ) +
        sec(
          'Estudando',
          (cb.estudando || []).length
            ? grp(cb.estudando.map((e) => row({ t: e.titulo, tags: [e.trilha], bar: e.progresso })))
            : '',
        ),
    };
  }

  function hoje(d) {
    const pl = d.planner || {},
      br = d.brain || {};
    return {
      title: 'Hoje',
      sub: d.fetchedAt ? 'atualizado ' + fmtDate(new Date(d.fetchedAt).toISOString()) : '',
      html:
        (br.brief
          ? hero(
              String(br.brief.headline || '').split('\n')[0],
              br.brief.nextMove ? `Próximo passo: ${br.brief.nextMove.title}` : br.brief.intro,
            )
          : '') +
        stats([
          { v: (pl.tasks || []).length, l: 'tarefas' },
          { v: (pl.events || []).length, l: 'eventos' },
          { v: pl.inboxUnhandled, l: 'inbox' },
          { v: br.unreadRelevant, l: 'leituras P0/P1' },
        ]) +
        sec(
          'Agenda',
          (pl.events || []).length
            ? `<div class="cd-tl">${pl.events.map((e) => row({ when: fmtDate(e.start), t: e.title, d: e.location })).join('')}</div>`
            : pl.calendarConnected
              ? ''
              : `<div class="cd-grp"><div class="cd-empty">Google Agenda desconectado.</div></div>`,
        ) +
        sec(
          'Tarefas',
          (pl.tasks || []).length
            ? grp(
                pl.tasks.map((t) =>
                  row({
                    t: t.title,
                    tags: [t.overdue ? 'atrasada' : ''],
                    when: t.dueAt ? 'prazo ' + fmtDate(t.dueAt) : '',
                  }),
                ),
              )
            : '',
        ) +
        sec(
          'Provas',
          (pl.exams || []).length
            ? grp(
                pl.exams.map((e) =>
                  row({
                    t: e.subject,
                    side: e.daysLeft,
                    sideLabel: 'dias',
                    when: fmtDate(e.examDate),
                  }),
                ),
              )
            : '',
        ) +
        sec(
          'Clientes',
          (pl.clients || []).length
            ? grp(
                pl.clients.map((c) =>
                  row({
                    t: c.name,
                    d: c.nextAction,
                    tags: [c.stage],
                    side: c.value ? 'R$ ' + fmtN(c.value) : '',
                  }),
                ),
              )
            : '',
        ) +
        sec(
          'Para ler',
          (br.top || []).length
            ? grp(
                br.top.map((t) => row({ t: t.title, d: t.why, url: t.url, tags: [t.priority] })),
                6,
              )
            : '',
        ) +
        sec(
          'Construindo',
          (br.builds || []).length
            ? grp(
                br.builds.map((b) =>
                  row({
                    t: b.name,
                    tags: [b.status],
                    bar: b.total ? (100 * b.done) / b.total : undefined,
                    side: b.total ? `${b.done}/${b.total}` : '',
                  }),
                ),
              )
            : '',
        ),
    };
  }

  function officeStatus(text) {
    const agents = [],
      extra = [];
    String(text)
      .split('\n')
      .forEach((l) => {
        const m = l.match(
          /^(\S+) = (.+?): (ocioso|trabalhando|aguardando_aprovacao)(?: \((.+?)\))?(?:, (\d+) na fila)?$/,
        );
        if (m) agents.push({ key: m[1], label: m[2], status: m[3], activity: m[4], queued: m[5] });
        else if (l.trim() && !/:\s*$/.test(l)) extra.push(l.trim());
      });
    if (!agents.length) return { title: 'Agentes do escritório', html: textBlock(text) };
    const busy = agents.filter((a) => a.status !== 'ocioso').length;
    return {
      title: 'Agentes do escritório',
      sub: busy ? `${busy} trabalhando agora` : 'todos livres',
      html:
        grp(
          agents.map((a) =>
            row({
              t: a.label,
              d: a.activity || a.key,
              tags: [a.status, a.queued ? `${a.queued} na fila` : ''],
            }),
          ),
          20,
        ) +
        (extra.length
          ? sec('Atenção', grp(extra.map((e) => row({ t: e, tags: ['aprovação'] }))))
          : ''),
    };
  }

  function agentCard(c) {
    const itens = Array.isArray(c.itens) ? c.itens : [];
    const r = (i) =>
      row({
        t: i.titulo,
        d: i.detalhe,
        tags: [i.tag],
        bar: typeof i.progresso === 'number' ? i.progresso : undefined,
        side: i.valor || '',
        url: i.url,
        when: i.quando || '',
      });
    let html;
    switch (c.tipo) {
      case 'metricas':
        html = `<div class="cd-stats">${itens.map((i) => `<div class="cd-stat"><b>${esc(i.valor ?? '')}</b><span>${esc(i.titulo ?? '')}</span>${i.detalhe ? `<span style="display:block;color:var(--text-3)">${esc(i.detalhe)}</span>` : ''}</div>`).join('')}</div>`;
        break;
      case 'tabela':
        html = table(c.colunas || [], c.linhas || []);
        break;
      case 'linha_do_tempo':
        html = `<div class="cd-tl">${itens.map((i) => row({ when: i.quando, t: i.titulo, d: i.detalhe, tags: [i.tag] })).join('')}</div>`;
        break;
      case 'passos':
        html = grp(itens.map(r), 30, 'cd-steps');
        break;
      case 'texto':
        html = textBlock(c.texto);
        break;
      default:
        html = grp(itens.map(r), 30);
    }
    if (c.tipo !== 'texto' && c.texto) html = textBlock(c.texto) + html;
    return { title: c.titulo || 'Jarvis', sub: c.subtitulo, html };
  }

  /* ---------- painel ---------- */
  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <section class="cd glass" id="cd" role="dialog" aria-label="Painel de informações">
      <div class="cd-head">
        <div style="min-width:0"><div class="cd-src" id="cdSrc"><i></i><span></span></div><div class="cd-title" id="cdTitle"></div><div class="cd-sub" id="cdSub"></div></div>
        <div class="cd-tools">
          <button class="cd-btn" id="cdPrev" aria-label="Painel anterior">‹</button><span class="cd-pos" id="cdPos"></span><button class="cd-btn" id="cdNext" aria-label="Próximo painel">›</button>
          <button class="cd-btn" id="cdClose" aria-label="Fechar painel"><svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg></button>
        </div>
      </div>
      <div class="cd-body" id="cdBody"></div>
    </section>`,
  );
  const el = (id) => document.getElementById(id);
  const cards = [];
  let idx = -1;

  function render() {
    const c = cards[idx];
    if (!c) return;
    const src = SRC[c.src] || SRC.mcp;
    el('cd').style.setProperty('--src', src.color);
    el('cdSrc').querySelector('span').textContent = c.srcLabel || src.label;
    el('cdTitle').textContent = c.title;
    el('cdSub').textContent = c.sub || '';
    el('cdBody').innerHTML = c.html;
    el('cdBody').scrollTop = 0;
    el('cdPos').textContent = cards.length > 1 ? `${idx + 1}/${cards.length}` : '';
    el('cdPrev').disabled = idx <= 0;
    el('cdNext').disabled = idx >= cards.length - 1;
    el('cdPrev').style.display = el('cdNext').style.display = cards.length > 1 ? '' : 'none';
  }
  function push(card) {
    cards.push(card);
    if (cards.length > 30) cards.shift();
    idx = cards.length - 1;
    render();
    el('cd').classList.add('open');
  }
  const close = () => el('cd').classList.remove('open');
  el('cdClose').onclick = close;
  el('cdPrev').onclick = () => {
    if (idx > 0) {
      idx--;
      render();
    }
  };
  el('cdNext').onclick = () => {
    if (idx < cards.length - 1) {
      idx++;
      render();
    }
  };
  addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      el('cd').classList.contains('open') &&
      !document.getElementById('pn')?.classList.contains('open')
    )
      close();
  });

  function safe(fn, fallbackTitle, data) {
    try {
      return fn();
    } catch (err) {
      console.warn('[wyCards] renderizador falhou, usando generico', err);
      return { title: fallbackTitle, html: generic(data) };
    }
  }

  function fromTool(m) {
    if (!m || m.phase !== 'end' || !m.ok || !m.data) return;
    const name = m.name || '',
      args = m.args || {};
    let src, tool, renderer;
    if (name.startsWith('mcp__')) {
      const [, server, t] = name.split('__');
      tool = t;
      if (WRITE_TOOLS.has(tool)) return;
      src = server === 'current-brain' ? 'brain' : server === 'planner-life' ? 'planner' : 'mcp';
      renderer = (src === 'brain' ? BRAIN : src === 'planner' ? PLANNER : {})[tool];
      const data = tryJSON(m.data);
      const out = safe(
        () =>
          renderer && typeof data === 'object'
            ? renderer(data, args)
            : { title: humanKey(tool), html: generic(data) },
        humanKey(tool),
        data,
      );
      push({ src, srcLabel: src === 'mcp' ? server : '', ...out });
    } else if (name === 'ler_dados_da_vida') {
      const data = tryJSON(m.data);
      push({ src: 'vida', ...safe(() => vida(data, args), 'Sua vida', data) });
    } else if (name === 'escritorio' && ESCRITORIO_VISUAL.has(args.action)) {
      const data = tryJSON(m.data);
      const titles = {
        status: 'Agentes do escritório',
        mural: 'Mural',
        lembretes: 'Lembretes',
        pendencias: 'Pedidos de aprovação',
        perguntar: args.agent ? `Resposta · ${args.agent}` : 'Resposta do escritório',
        ultima_resposta: 'Última resposta',
      };
      const out =
        args.action === 'hoje' && typeof data === 'object'
          ? safe(() => hoje(data), 'Hoje', data)
          : args.action === 'status'
            ? safe(() => officeStatus(m.data), titles.status, m.data)
            : {
                title: titles[args.action] || 'Brain Office',
                sub: args.action === 'perguntar' ? args.text : '',
                html: textBlock(m.data),
              };
      push({ src: 'escritorio', ...out });
    }
  }

  // mesmo criterio do fromTool, sem desenhar: o orb usa pra decidir se abre o painel flutuante
  function accepts(m) {
    if (!m || m.phase !== 'end' || !m.ok || !m.data) return false;
    const name = m.name || '';
    if (name.startsWith('mcp__')) return !WRITE_TOOLS.has(name.split('__')[2]);
    if (name === 'ler_dados_da_vida') return true;
    return name === 'escritorio' && ESCRITORIO_VISUAL.has((m.args || {}).action);
  }

  function fromAgent(card) {
    if (!card) return;
    push({ src: 'jarvis', ...safe(() => agentCard(card), card.titulo || 'Jarvis', card) });
  }

  window.wyCards = {
    fromTool,
    accepts,
    fromAgent,
    close,
    _render: { generic, vida, hoje, agentCard, BRAIN, PLANNER },
    // blocos visuais reaproveitados pela Central (orb-central.js)
    ui: { esc, row, grp, sec, stats, chips, table, hero, textBlock, fmtDate, fmtN, tagText },
  };
})();
