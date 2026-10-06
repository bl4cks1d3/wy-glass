// Terminal por voz: conversa com o Claude Code na pasta atual (voice_terminal.py). Abre por voz
// (ferramenta terminal), pelo dock ou por Ctrl+J. O andamento vem de /api/terminal (consulta
// enquanto o painel esta aberto -- o painel flutuante nao tem WebSocket proprio).
(() => {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // markdown do Claude Code renderizado e sanitizado; sem as libs (offline), texto puro
  const md = (text) =>
    window.marked && window.DOMPurify
      ? window.DOMPurify.sanitize(window.marked.parse(text || '', { breaks: true, gfm: true }))
      : `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;

  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <section class="tm" id="tm" role="dialog" aria-label="Terminal do Claude Code">
      <div class="tm-head">
        <div style="min-width:0">
          <div class="tm-src"><i id="tmDot"></i><span>Claude Code · terminal por voz</span></div>
          <div class="tm-title" id="tmTitle">Terminal</div>
          <div class="tm-path" id="tmPath"></div>
        </div>
        <div class="tm-tools">
          <button class="tm-btn" id="tmNew" title="Nova conversa nesta pasta">＋</button>
          <button class="tm-btn" id="tmStop" title="Parar o Claude Code">■</button>
          <button class="tm-btn" id="tmClose" title="Fechar (Esc)">✕</button>
        </div>
      </div>
      <div class="tm-body" id="tmBody"></div>
      <form class="tm-input" id="tmForm" autocomplete="off">
        <input id="tmText" placeholder="Fale com o Jarvis ou digite: um pedido, ou cd pasta" maxlength="4000">
        <button class="tm-send" type="submit" aria-label="Enviar">↑</button>
      </form>
    </section>`,
  );
  const $ = (id) => document.getElementById(id);
  let poll = null,
    lastLen = -1,
    lastBusy = null;

  function row(e) {
    switch (e.kind) {
      case 'user':
        return `<div class="tm-user"><span>${esc(e.text)}</span></div>`;
      case 'assistant':
        return `<div class="tm-ai md">${md(e.text)}</div>`;
      case 'tool':
        return `<div class="tm-tool"><i></i>${esc(e.text)}</div>`;
      case 'nav':
        return `<div class="tm-nav">${esc(e.text)}</div>`;
      case 'done':
        return `<div class="tm-done">✓ ${esc(e.text)}</div>`;
      case 'error':
        return `<div class="tm-err">${esc(e.text)}</div>`;
      default:
        return '';
    }
  }

  async function refresh() {
    let s;
    try {
      s = await fetch('/api/terminal').then((r) => r.json());
    } catch {
      return;
    }
    $('tmTitle').textContent = s.name || 'Terminal';
    $('tmPath').textContent = s.cwd + (s.has_session ? '  ·  conversa em andamento' : '');
    $('tmDot').className = s.busy ? 'busy' : '';
    $('tmStop').disabled = !s.busy;
    if (s.entries.length === lastLen && s.busy === lastBusy) return;
    const body = $('tmBody');
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    body.innerHTML =
      (s.entries.length
        ? s.entries.map(row).join('')
        : `<div class="tm-empty">Diga “entra na pasta …” pra navegar e peça o que quiser construir.<br>Ex.: “cria uma landing page em Next.js aqui”.</div>`) +
      (s.busy ? `<div class="tm-working"><span></span><span></span><span></span> ${esc(s.task || '')}</div>` : '');
    if (atBottom || lastLen === -1) body.scrollTop = body.scrollHeight;
    lastLen = s.entries.length;
    lastBusy = s.busy;
  }

  async function post(action, data) {
    await fetch('/api/terminal/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    }).catch(() => {});
    refresh();
  }

  function open() {
    $('tm').classList.add('open');
    lastLen = -1;
    refresh();
    clearInterval(poll);
    poll = setInterval(refresh, 1200);
  }
  function close() {
    $('tm').classList.remove('open');
    clearInterval(poll);
  }

  $('tmClose').onclick = close;
  $('tmStop').onclick = () => post('stop');
  $('tmNew').onclick = () => post('new');
  $('tmForm').onsubmit = (e) => {
    e.preventDefault();
    const t = $('tmText').value.trim();
    if (!t) return;
    $('tmText').value = '';
    const cd = t.match(/^cd\s+(.+)$/i);
    if (cd) post('cd', { path: cd[1] });
    else if (/^(ls|dir)$/i.test(t)) post('ls');
    else post('ask', { text: t });
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('tm').classList.contains('open')) close();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      $('tm').classList.contains('open') ? close() : open();
    }
  });

  window.wyTerminal = { open, close };
})();
