// Painel de controle do orb (/orb). Le e grava config.json via /api/config (merge por chave de
// topo — ver server.py::set_config), autosave a cada mudanca. Avisa o orb com o evento
// "wy:config" pra ele recarregar agentes/gateway.
(() => {
  const ICONS = {
    person: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" />',
    wave: '<path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />',
    nodes:
      '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.4-1.8L8 14" />',
    wrench:
      '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 1-2-2ZM5 5l3 3" />',
    glasses:
      '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14h4M3 13l2-6M21 13l-2-6"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" />',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>',
  };
  const SECTIONS = [
    { id: 'perfil', label: 'Perfil', icon: 'person', color: '#0a84ff' },
    { id: 'live', label: 'Voz Live', icon: 'wave', color: '#ff375f' },
    { id: 'agentes', label: 'Agentes', icon: 'nodes', color: '#bf5af2' },
    { id: 'gestos', label: 'Gestos', icon: 'hand', color: '#ff9f0a' },
    { id: 'ferramentas', label: 'Ferramentas', icon: 'wrench', color: '#64d2ff' },
    { id: 'mcp', label: 'Servidores MCP', icon: 'plug', color: '#5e5ce6' },
    { id: 'dispositivo', label: 'Óculos', icon: 'glasses', color: '#30d158' },
    { id: 'chaves', label: 'Chaves de API', icon: 'key', color: '#8e8e93' },
  ];
  const LIVE_MODELS = [
    'gemini-3.1-flash-live-preview',
    'gemini-3.8-live',
    'gemini-2.5-flash-native-audio-latest',
  ];
  const VOICES = ['Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
  const ACTIONS = {
    live_agent: 'Modo Live (liga/desliga)',
    open_jarvis_agent: 'Jarvis clássico (um turno)',
    translator_agent: 'Tradutor PT↔EN',
    stop_conversation: 'Encerrar conversa',
    open_dashboard: 'Abrir dashboard',
    run_command: 'Executar comando',
    open_url: 'Abrir URL',
    key_shortcut: 'Atalho de teclado',
    screenshot: 'Captura de tela',
    voice_command: 'Gravar áudio',
    jarvis_voice_agent: 'Jarvis multi-provedor',
  };
  const GESTURE_NAMES = {
    button1_single: 'Botão 1 · clique',
    button1_double: 'Botão 1 · duplo',
    button1_triple: 'Botão 1 · triplo',
    button2_single: 'Botão 2 · clique',
    button2_double: 'Botão 2 · duplo',
    button2_triple: 'Botão 2 · triplo',
    wake_word_command: 'Wake word “Hey Jarvis”',
  };

  let cfg = null,
    current = 'perfil',
    saveTimer = null;
  const pending = {};
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const svg = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

  /* ---------- shell ---------- */
  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <div class="pn-scrim" id="pnScrim"></div>
    <section class="pn glass" id="pn" role="dialog" aria-label="Painel de controle">
      <nav class="pn-side"><h2>Wy Glass</h2>${SECTIONS.map(
        (s) => `
        <button class="pn-nav" data-sec="${s.id}"><span class="pn-ico" style="background:${s.color}">${svg(s.icon)}</span>${s.label}</button>`,
      ).join('')}
      </nav>
      <div class="pn-main">
        <div class="pn-head"><div><button class="pn-back" id="pnBack">‹ Ajustes</button><h1 id="pnTitle"></h1></div>
          <button class="pn-close" id="pnClose" aria-label="Fechar"><svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg></button></div>
        <div class="pn-body" id="pnBody"></div>
      </div>
    </section>`,
  );
  const pn = document.getElementById('pn'),
    body = document.getElementById('pnBody');

  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function open(sec) {
    cfg = await fetch('/api/config')
      .then((r) => r.json())
      .catch(() => null);
    if (!cfg) return toast('servidor offline');
    pn.classList.add('open');
    document.getElementById('pnScrim').classList.add('open');
    show(sec || current, !sec && innerWidth <= 720 ? false : true);
  }
  function close() {
    flush();
    pn.classList.remove('open', 'detail');
    document.getElementById('pnScrim').classList.remove('open');
  }
  function show(sec, detail = true) {
    current = sec;
    pn.classList.toggle('detail', detail);
    pn.querySelectorAll('.pn-nav').forEach((b) =>
      b.classList.toggle('active', b.dataset.sec === sec),
    );
    document.getElementById('pnTitle').textContent = SECTIONS.find((s) => s.id === sec).label;
    body.innerHTML = '';
    RENDER[sec]();
    body.scrollTop = 0;
  }
  pn.querySelectorAll('.pn-nav').forEach((b) => (b.onclick = () => show(b.dataset.sec)));
  document.getElementById('pnClose').onclick = close;
  document.getElementById('pnScrim').onclick = close;
  document.getElementById('pnBack').onclick = () => pn.classList.remove('detail');
  addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && pn.classList.contains('open')) {
        e.stopImmediatePropagation();
        close();
      }
      if (e.code === 'Space' && pn.classList.contains('open')) e.stopImmediatePropagation();
    },
    true,
  );

  /* ---------- save ---------- */
  function set(topKey, value) {
    cfg[topKey] = value;
    pending[topKey] = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }
  async function flush() {
    clearTimeout(saveTimer);
    const keys = Object.keys(pending);
    if (!keys.length) return;
    const payload = {};
    keys.forEach((k) => {
      payload[k] = pending[k];
      delete pending[k];
    });
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!r || !r.ok) return toast('falha ao salvar');
    toast(
      keys.some((k) => ['live', 'user_profile', 'nine_router', 'claude_code'].includes(k))
        ? 'Salvo · vale na próxima sessão Live'
        : 'Salvo',
    );
    dispatchEvent(new Event('wy:config'));
  }

  /* ---------- builders ---------- */
  const group = (title, rows, foot) => {
    body.insertAdjacentHTML(
      'beforeend',
      `${title ? `<div class="grp-title">${title}</div>` : ''}<div class="grp">${rows.join('')}</div>${foot ? `<div class="grp-foot">${foot}</div>` : ''}`,
    );
  };
  const lbl = (t, sub) => `<div class="lbl">${t}${sub ? `<small>${sub}</small>` : ''}</div>`;
  const text = (id, t, v, opts = {}) =>
    `<div class="row${opts.col ? ' col' : ''}">${lbl(t, opts.sub)}<input type="${opts.type || 'text'}" id="${id}" value="${esc(v)}" placeholder="${esc(opts.ph || '')}" autocomplete="off" spellcheck="false"></div>`;
  const area = (id, t, v, opts = {}) =>
    `<div class="row col">${lbl(t, opts.sub)}<textarea id="${id}" class="${opts.code ? 'code' : ''}" spellcheck="${!opts.code}">${esc(v)}</textarea></div>`;
  const toggle = (id, t, on, sub) =>
    `<div class="row">${lbl(t, sub)}<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label></div>`;
  const select = (id, t, v, options, sub) =>
    `<div class="row">${lbl(t, sub)}<select id="${id}">${Object.entries(options)
      .map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`)
      .join('')}</select></div>`;
  const range = (id, t, v, min, max, step, unit, sub) =>
    `<div class="row">${lbl(t, sub)}<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val" id="${id}V" style="min-width:64px;text-align:right">${v}${unit}</span></div>`;
  const info = (t, v, sub) => `<div class="row">${lbl(t, sub)}<span class="val">${v}</span></div>`;
  const asObj = (list) => Object.fromEntries(list.map((x) => [x, x]));
  const $ = (id) => document.getElementById(id);
  const bind = (id, fn, ev) => {
    const el = $(id);
    if (el)
      el.addEventListener(
        ev || (el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input'),
        () => fn(el.type === 'checkbox' ? el.checked : el.value, el),
      );
  };

  /* ---------- sections ---------- */
  const RENDER = {
    perfil() {
      const p = cfg.user_profile || {};
      group('Como o Jarvis te conhece', [
        text('pfName', 'Como te chamar', p.user_name),
        text('pfRole', 'Papel', p.user_role, { col: true }),
        area('pfCtx', 'Contexto', p.user_context, {
          sub: 'Stack, projetos, interesses e como você prefere as respostas — vai no prompt de todo turno, clássico e Live.',
        }),
      ]);
      const up = (k) => (v) => set('user_profile', { ...(cfg.user_profile || {}), [k]: v });
      bind('pfName', up('user_name'));
      bind('pfRole', up('user_role'));
      bind('pfCtx', up('user_context'));
      group('Tom', [
        info(
          'Persona padrão',
          'Parceiro técnico',
          'Troque por voz: “modo mordomo”, “modo sério”, “modo professor”, “volta ao normal”.',
        ),
      ]);
    },

    live() {
      const l = cfg.live || {};
      const models = asObj(
        LIVE_MODELS.includes(l.model) || !l.model ? LIVE_MODELS : [l.model, ...LIVE_MODELS],
      );
      group('Modelo', [
        select(
          'lvModel',
          'Modelo Gemini Live',
          l.model || LIVE_MODELS[0],
          models,
          'Speech-to-speech nativo, com tool calling.',
        ),
        select('lvVoice', 'Voz', l.voice || 'Charon', asObj(VOICES)),
      ]);
      group(
        'Microfone',
        [
          range(
            'lvBarge',
            'Sensibilidade de interrupção',
            l.barge_in_rms ?? 2500,
            500,
            8000,
            100,
            '',
            'Enquanto o Jarvis fala, só passa voz acima disso. Se ele se corta sozinho, aumente; se não dá pra interromper, diminua.',
          ),
          range('lvSil', 'Silêncio para fim de fala', l.silence_ms ?? 600, 200, 2000, 50, ' ms'),
        ],
        'Os óculos são open-ear — o alto-falante fica colado no microfone, por isso o gate anti-eco.',
      );
      const up = (k, num) => (v, el) => {
        if ($(el.id + 'V')) $(el.id + 'V').textContent = v + (k === 'silence_ms' ? ' ms' : '');
        set('live', { ...(cfg.live || {}), [k]: num ? Number(v) : v });
      };
      bind('lvModel', up('model'));
      bind('lvVoice', up('voice'));
      bind('lvBarge', up('barge_in_rms', true));
      bind('lvSil', up('silence_ms', true));

      const lines = (v) =>
        v
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
      group('Pausa', [
        area('lvPause', 'Frases que pausam', (l.pause_phrases || []).join('\n'), {
          sub: 'Uma por linha. Dita sozinha (frase curta), o Jarvis para de ouvir na hora. Ele também entende pedidos livres como “espera que vou atender alguém”.',
        }),
        area('lvWake', 'Frases que retomam', (l.wake_phrases || []).join('\n'), {
          sub: 'Uma por linha, quantas quiser. Prefira 2+ palavras. Detectadas 100% no computador: durante a pausa nada vai pra nuvem.',
        }),
        range(
          'lvPauseT',
          'Encerrar Live após pausa de',
          l.pause_timeout_min ?? 30,
          5,
          120,
          5,
          ' min',
        ),
        `<div class="row">${lbl('Botão 1 dos óculos', 'Com o Live ativo, um clique pausa e outro retoma.')}<span class="val">clique simples</span></div>`,
      ]);
      bind('lvPause', (v) => set('live', { ...(cfg.live || {}), pause_phrases: lines(v) }));
      bind('lvWake', (v) => {
        set('live', { ...(cfg.live || {}), wake_phrases: lines(v) });
        renderCalib();
      });
      bind('lvPauseT', (v, el) => {
        $(el.id + 'V').textContent = v + ' min';
        set('live', { ...(cfg.live || {}), pause_timeout_min: Number(v) });
      });

      body.insertAdjacentHTML(
        'beforeend',
        `<div class="grp-title">Calibrar com a sua voz</div><div class="grp" id="calib"></div><div class="grp-foot">Nomes e palavras em inglês (“sankofa”, “jarvis”) podem não estar no vocabulário do reconhecedor local. Toque em Calibrar e fale a frase em até 3 segundos: o jeito que ele escuta você vira um apelido da frase.</div>`,
      );
      function renderCalib() {
        const wl = (cfg.live && cfg.live.wake_phrases) || [];
        const al = (cfg.live && cfg.live.wake_aliases) || {};
        $('calib').innerHTML =
          wl
            .map(
              (w, i) =>
                `<div class="row">${lbl(esc(w), (al[w] || []).length ? 'ouve como: ' + esc(al[w].join(', ')) : 'sem calibração')}<button class="pbtn" data-cal="${i}">Calibrar</button></div>`,
            )
            .join('') || `<div class="row">${lbl('Nenhuma frase de retomada')}</div>`;
        $('calib')
          .querySelectorAll('[data-cal]')
          .forEach(
            (b) =>
              (b.onclick = async () => {
                const phrase = wl[Number(b.dataset.cal)];
                await flush();
                b.disabled = true;
                b.textContent = 'Fale agora…';
                const r = await fetch('/api/live/wake/calibrate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phrase }),
                })
                  .then((x) => x.json())
                  .catch(() => ({ ok: false, error: 'sem resposta' }));
                if (r.ok) {
                  cfg.live = cfg.live || {};
                  cfg.live.wake_aliases = cfg.live.wake_aliases || {};
                  if (r.aliases) cfg.live.wake_aliases[phrase] = r.aliases;
                  toast(r.added ? `Aprendi: “${r.heard}”` : r.note || 'Ok');
                } else toast(r.error || 'Falhou');
                renderCalib();
              }),
          );
      }
      renderCalib();
    },

    agentes() {
      const nr = cfg.nine_router || {},
        cc = cfg.claude_code || {},
        om = cfg.omni_route || {};
      group(
        '9router',
        [
          toggle(
            'nrOn',
            'Usar 9router',
            nr.enabled,
            'Gateway OpenAI-compatible local com fallback entre provedores. Agentes Pesquisador, Operador e Generalista passam por ele.',
          ),
          text('nrUrl', 'Endereço', nr.base_url || 'http://localhost:20128/v1'),
          text('nrModel', 'Modelo / combo', nr.model || 'auto', {
            ph: 'ex: provedor/modelo ou nome do combo',
          }),
          text('nrKey', 'API key', nr.api_key, { type: 'password', ph: 'opcional' }),
          `<div class="row">${lbl('Conexão', 'Lista os modelos expostos pelo gateway.')}<span class="badge" id="nrBadge">—</span><button class="pbtn" id="nrTest">Testar</button></div>`,
        ],
        'Instale com <code>npm i -g 9router</code> e rode <code>9router</code> (painel em localhost:20128). Desligado, os agentes usam a Groq direto.',
      );
      const upNr = (k) => (v) => set('nine_router', { ...(cfg.nine_router || {}), [k]: v });
      bind('nrOn', upNr('enabled'));
      bind('nrUrl', upNr('base_url'));
      bind('nrModel', upNr('model'));
      bind('nrKey', upNr('api_key'));
      $('nrTest').onclick = async () => {
        await flush();
        const b = $('nrBadge');
        b.className = 'badge';
        b.textContent = 'testando…';
        const h = await fetch('/api/gateway/health')
          .then((r) => r.json())
          .catch(() => ({ ok: false, error: 'sem resposta' }));
        b.className = 'badge ' + (h.ok ? 'ok' : 'bad');
        b.textContent = h.ok
          ? h.models
            ? `${h.provider} · ${h.models.length} modelos`
            : h.provider
          : 'offline';
        if (h.models?.length) {
          let dl = $('nrModels');
          if (!dl) {
            dl = document.createElement('datalist');
            dl.id = 'nrModels';
            body.appendChild(dl);
          }
          dl.innerHTML = h.models.map((m) => `<option value="${esc(m)}">`).join('');
          $('nrModel').setAttribute('list', 'nrModels');
        }
        if (!h.ok) toast(h.error || h.detail || 'gateway offline');
      };

      group('Claude Code', [
        toggle(
          'ccOn',
          'Agente Claude',
          cc.enabled !== false,
          'Roda o claude CLI em modo headless com o login da sua assinatura — sem API key, sem proxy.',
        ),
        text('ccCwd', 'Pasta de trabalho', cc.cwd, { ph: 'padrão: sua pasta de usuário' }),
        select('ccModel', 'Modelo', cc.model || '', {
          '': 'Padrão do CLI',
          sonnet: 'Sonnet',
          opus: 'Opus',
          haiku: 'Haiku',
        }),
        text(
          'ccTools',
          'Ferramentas liberadas',
          (cc.allowed_tools || ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch']).join(', '),
          {
            col: true,
            sub: 'Separadas por vírgula. Sem quem aprove no modo headless, o que não estiver aqui é negado. Adicionar Edit/Write/Bash deixa o agente alterar arquivos.',
          },
        ),
        range('ccTimeout', 'Tempo limite', cc.timeout_seconds ?? 180, 30, 600, 10, ' s'),
      ]);
      const upCc = (k, conv) => (v, el) => {
        if (el && $(el.id + 'V')) $(el.id + 'V').textContent = v + ' s';
        set('claude_code', { ...(cfg.claude_code || {}), [k]: conv ? conv(v) : v });
      };
      bind('ccOn', upCc('enabled'));
      bind('ccCwd', upCc('cwd'));
      bind('ccModel', upCc('model'));
      bind(
        'ccTools',
        upCc('allowed_tools', (v) =>
          v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      );
      bind('ccTimeout', upCc('timeout_seconds', Number));

      group('OmniRoute', [
        toggle(
          'omOn',
          'Usar OmniRoute',
          om.enabled,
          'Alternativa ao 9router (mesma porta). Se os dois estiverem ligados, o 9router vence.',
        ),
      ]);
      bind('omOn', (v) => set('omni_route', { ...(cfg.omni_route || {}), enabled: v }));
    },

    gestos() {
      const g = cfg.gestures || {};
      const keys = Object.keys(GESTURE_NAMES)
        .filter((k) => g[k])
        .concat(Object.keys(g).filter((k) => !GESTURE_NAMES[k]));
      keys.forEach((k) => {
        const gc = g[k];
        const actions = ACTIONS[gc.action] ? ACTIONS : { ...ACTIONS, [gc.action]: gc.action };
        group(GESTURE_NAMES[k] || k, [
          `<div class="row"><div class="lbl gest-head">${esc(gc.label || '')}</div><button class="pbtn" data-test="${k}">Testar</button></div>`,
          select(`ga_${k}`, 'Ação', gc.action, actions),
          `<div class="row col"><details class="adv"><summary>Parâmetros (JSON)</summary><textarea class="code" id="gp_${k}">${esc(JSON.stringify(gc.params || {}, null, 2))}</textarea></details></div>`,
        ]);
        bind(`ga_${k}`, (v) => {
          cfg.gestures[k].action = v;
          cfg.gestures[k].label = `${GESTURE_NAMES[k] || k} · ${ACTIONS[v] || v}`;
          set('gestures', cfg.gestures);
        });
        bind(`gp_${k}`, (v, el) => {
          try {
            cfg.gestures[k].params = JSON.parse(v || '{}');
            el.style.boxShadow = '';
            set('gestures', cfg.gestures);
          } catch {
            el.style.boxShadow = '0 0 0 2px var(--red)';
          }
        });
      });
      body.querySelectorAll('[data-test]').forEach(
        (b) =>
          (b.onclick = async () => {
            await flush();
            await fetch(`/api/test/${b.dataset.test}`, { method: 'POST' });
            toast(
              cfg.actions_enabled
                ? 'Gesto disparado'
                : 'Modo teste: ação não executada (ligue em Óculos)',
            );
          }),
      );
    },

    async ferramentas() {
      const data = await fetch('/api/skills')
        .then((r) => r.json())
        .catch(() => ({ skills: [] }));
      if (current !== 'ferramentas') return; // usuario trocou de secao enquanto carregava
      const rows = data.skills.map((s) =>
        toggle(
          `sk_${s.name}`,
          s.name.replace(/^mcp__([^_]+)__/, '$1 · '),
          s.enabled,
          esc(s.description.slice(0, 140)) + (s.description.length > 140 ? '…' : ''),
        ),
      );
      group(
        `${data.skills.length} ferramentas`,
        rows.length ? rows : [info('Nenhuma ferramenta carregada', '')],
        'Valem pro Jarvis clássico, pro modo Live e pros agentes. Novas skills: arquivos em skills/ ou servidores MCP em config.json.',
      );
      data.skills.forEach((s) =>
        bind(`sk_${s.name}`, () => {
          const enabled = data.skills.filter((x) => $(`sk_${x.name}`).checked).map((x) => x.name);
          set('enabled_skills', enabled.length === data.skills.length ? null : enabled);
        }),
      );
    },

    async mcp() {
      const data = await fetch('/api/mcp')
        .then((r) => r.json())
        .catch(() => ({ servers: [] }));
      if (current !== 'mcp') return;
      const servers = cfg.mcp_servers || [];
      if (!servers.length)
        group(
          '',
          [info('Nenhum servidor configurado', '')],
          'Adicione em config.json > mcp_servers.',
        );
      data.servers.forEach((st, i) => {
        const sc = servers.find((x) => x.name === st.name);
        if (!sc) return;
        const allow = sc.tools && sc.tools.length ? new Set(sc.tools) : null;
        const badge = !st.enabled
          ? '<span class="badge">desligado</span>'
          : st.error
            ? '<span class="badge bad">erro</span>'
            : st.connected
              ? `<span class="badge ok">${st.tools.length} de ${st.all_tools.length} tools</span>`
              : '<span class="badge">desconectado</span>';
        const toolRows = st.all_tools.map((t) => toggle(`mt_${i}_${t}`, t, !allow || allow.has(t)));
        group(
          st.name,
          [
            `<div class="row">${lbl(esc(sc.description || sc.command), st.error ? `<span style="color:var(--red)">${esc(st.error)}</span>` : '')}${badge}</div>`,
            toggle(`ms_${i}`, 'Ativo', sc.enabled !== false),
            toolRows.length
              ? `<div class="row col"><details class="adv"><summary>Ferramentas na voz do Jarvis</summary><div class="grp" style="margin-top:8px">${toolRows.join('')}</div></details></div>`
              : '',
          ].filter(Boolean),
        );
        bind(`ms_${i}`, (v) => {
          sc.enabled = v;
          set('mcp_servers', servers);
        });
        st.all_tools.forEach((t) =>
          bind(`mt_${i}_${t}`, () => {
            const on = st.all_tools.filter((x) => $(`mt_${i}_${x}`).checked);
            // sempre lista explicita: "sem filtro" faria qualquer tool nova do servidor entrar na voz
            sc.tools = on;
            set('mcp_servers', servers);
          }),
        );
      });
      group(
        '',
        [
          `<div class="row">${lbl('Aplicar mudanças', 'Reconecta os servidores com a config atual. Vale na próxima sessão Live.')}<button class="pbtn primary" id="mcpRe">Reconectar</button></div>`,
        ],
        'As marcadas vão direto pra voz (poucas = voz mais rápida e certeira). O agente Cérebro recebe todas as tools dos servidores, menos as de exclusão.',
      );
      $('mcpRe').onclick = async (e) => {
        e.target.textContent = 'Reconectando…';
        await flush();
        await fetch('/api/mcp/reconnect', { method: 'POST' });
        dispatchEvent(new Event('wy:config'));
        show('mcp');
      };
    },

    async dispositivo() {
      const st = await fetch('/api/status')
        .then((r) => r.json())
        .catch(() => ({}));
      if (current !== 'dispositivo') return; // usuario trocou de secao enquanto carregava
      const pl = cfg.passive_listening || {},
        ww = pl.wake_word || {};
      group('Conexão', [
        `<div class="row">${lbl('Status')}<span class="badge ${st.connected ? 'ok' : 'bad'}">${st.connected ? 'conectado' : 'desconectado'}</span><button class="pbtn" id="dvRe">Reconectar</button></div>`,
        info('Bateria', st.battery_percent != null ? st.battery_percent + '%' : '—'),
        info('Firmware', esc(st.firmware || '—')),
        info('Endereço BLE', esc(st.device_address || '—')),
        info('Versão do app', esc(st.app_version || '—')),
      ]);
      $('dvRe').onclick = async () => {
        await fetch('/api/reconnect', { method: 'POST' });
        toast('Reconectando…');
      };
      group('Execução', [
        toggle(
          'dvAct',
          'Ações reais',
          st.actions_enabled,
          'Desligado = modo teste: gestos aparecem no feed mas nada é executado.',
        ),
        range('dvBatt', 'Aviso de bateria baixa', cfg.battery_low_threshold ?? 20, 5, 50, 5, '%'),
      ]);
      bind('dvAct', async (v) => {
        cfg.actions_enabled = v;
        await fetch('/api/actions_enabled', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: v }),
        });
        toast(v ? 'Ações reais ligadas' : 'Modo teste');
      });
      bind('dvBatt', (v) => {
        $('dvBattV').textContent = v + '%';
        set('battery_low_threshold', Number(v));
      });
      group(
        'Escuta passiva',
        [
          toggle(
            'dvPl',
            'Escuta passiva',
            pl.enabled,
            'Microfone sempre aberto para a wake word (pausa sozinha durante o Live).',
          ),
          toggle('dvWw', 'Wake word “Hey Jarvis”', ww.enabled),
          range('dvWwT', 'Limiar da wake word', ww.threshold ?? 0.5, 0.2, 0.9, 0.05, ''),
        ],
        'Mudanças na escuta passiva valem depois de reiniciar o servidor.',
      );
      const upPl = (fn) => (v) => {
        const n = structuredClone(cfg.passive_listening || {});
        fn(n, v);
        set('passive_listening', n);
      };
      bind(
        'dvPl',
        upPl((n, v) => (n.enabled = v)),
      );
      bind(
        'dvWw',
        upPl((n, v) => ((n.wake_word ||= {}).enabled = v)),
      );
      bind('dvWwT', (v) => {
        $('dvWwTV').textContent = v;
        upPl((n, x) => ((n.wake_word ||= {}).threshold = Number(x)))(v);
      });
    },

    chaves() {
      const c = cfg.credentials || {};
      group(
        'Provedores',
        [
          text('kGoogle', 'Google Gemini', c.google_api_key, {
            type: 'password',
            sub: 'Modo Live e visão',
          }),
          text('kGroq', 'Groq', c.groq_api_key, {
            type: 'password',
            sub: 'Whisper e agentes sem gateway',
          }),
          text('kTavily', 'Tavily', c.tavily_api_key, { type: 'password', sub: 'Busca web' }),
        ],
        'Ficam só no config.json desta máquina. O Claude Code usa o login da assinatura, não precisa de chave aqui.',
      );
      const up = (k) => (v) => set('credentials', { ...(cfg.credentials || {}), [k]: v });
      bind('kGoogle', up('google_api_key'));
      bind('kGroq', up('groq_api_key'));
      bind('kTavily', up('tavily_api_key'));
    },
  };

  window.wyPanel = { open, close };
})();
