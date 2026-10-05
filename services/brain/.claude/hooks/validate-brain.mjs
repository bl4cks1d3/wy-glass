#!/usr/bin/env node
// PreToolUse hook for the current-brain MCP tools (see .claude/settings.json).
// Blocks writes that pass the schema but break the product rules; exit code 2 sends the
// message back to the agent so it can fix and retry. Anything unexpected → allow (exit 0).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs', 'hook-blocks.jsonl');

const MIN_SUMMARY = 40;
const MIN_WHY = 25;
const MIN_REASON = 15;
const MIN_CONCEPT = 600;
const MIN_STEP = 80;
const SEARCH_PAGES =
  /(google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/\?q|youtube\.com\/results|search\.yahoo\.com)/i;

function read() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

const norm = (s) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const short = (s, n = 60) => ((s ?? '').length > n ? s.slice(0, n) + '…' : (s ?? ''));

/** Same text used for 3+ items in one batch = a generic label, not a per-item judgement. */
function repeated(values, min = 3) {
  const counts = new Map();
  for (const v of values.map(norm).filter(Boolean)) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= min).map(([v, n]) => `"${short(v)}" (${n}×)`);
}

function checkUrls(list, label) {
  const out = [];
  for (const { url, where } of list) {
    if (!url) continue;
    if (!/^https?:\/\//.test(url)) out.push(`${label} ${where}: URL inválida (${short(url)}).`);
    else if (SEARCH_PAGES.test(url))
      out.push(
        `${label} ${where}: é uma página de resultados de busca, não a fonte (${short(url)}). Abra o resultado e use a URL real.`,
      );
  }
  return out;
}

const RULES = {
  save_content_analysis({ items = [] }) {
    const p = [];
    items.forEach((it, i) => {
      const at = `item ${i + 1} (${it.id?.slice(0, 8)})`;
      if (norm(it.summary).length < MIN_SUMMARY)
        p.push(
          `${at}: summary tem menos de ${MIN_SUMMARY} caracteres. Resuma o que a fonte diz; se o trecho for curto demais, faça WebFetch na URL.`,
        );
      if (norm(it.whyItMatters).length < MIN_WHY)
        p.push(
          `${at}: whyItMatters vazio ou curto demais. Cite pelo nome a meta, o projeto, a lacuna ou a tecnologia do usuário.`,
        );
      if (it.summary && norm(it.summary) === norm(it.whyItMatters))
        p.push(
          `${at}: summary e whyItMatters são iguais. São camadas diferentes: fato da fonte ≠ interpretação para o usuário.`,
        );
      if (['P0', 'P1', 'P2'].includes(it.priority) && (it.keyPoints?.length ?? 0) < 2)
        p.push(`${at}: prioridade ${it.priority} exige pelo menos 2 keyPoints.`);
      if (it.area === 'frontier' && (it.maturity == null || !it.signals))
        p.push(`${at}: itens de frontier precisam de maturity (1–5) e signals.`);
    });
    const generic = repeated(items.map((i) => i.whyItMatters));
    if (generic.length)
      p.push(
        `whyItMatters repetido no lote: ${generic.join(', ')}. Escreva o porquê de cada item.`,
      );
    return p;
  },

  ignore_content({ items, ids, reason }) {
    const p = [];
    if (ids?.length > 1 && !items?.length)
      p.push(
        `Descarte em lote com um só motivo (ids + reason). Use items: [{id, reason}] com um motivo específico por item; o usuário lê esses motivos na aba Descartados.`,
      );
    (items ?? []).forEach((it, i) => {
      if (norm(it.reason).length < MIN_REASON)
        p.push(
          `item ${i + 1} (${it.id?.slice(0, 8)}): motivo curto demais. Diga o que é o item e por que está fora do foco.`,
        );
    });
    const generic = repeated((items ?? []).map((i) => i.reason));
    if (generic.length)
      p.push(`Motivo de descarte repetido: ${generic.join(', ')}. Um motivo específico por item.`);
    if (ids?.length === 1 && norm(reason).length < MIN_REASON)
      p.push('Motivo de descarte ausente ou curto demais.');
    return p;
  },

  write_lesson({ steps = [], sources = [] }) {
    const p = [];
    const concept = steps.find((s) => s.kind === 'concept');
    if (!concept) p.push('A aula precisa de uma etapa kind: concept.');
    else if ((concept.body ?? '').length < MIN_CONCEPT)
      p.push(
        `A etapa de conceito tem ${concept.body?.length ?? 0} caracteres; o mínimo é ${MIN_CONCEPT}. Explique o que é, o problema que resolve e como funciona.`,
      );
    steps.forEach((s, i) => {
      if ((s.body ?? '').trim().length < MIN_STEP)
        p.push(
          `Etapa ${i + 1} ("${short(s.name, 40)}"): body curto demais (mín. ${MIN_STEP} caracteres).`,
        );
      if (s.kind === 'code' && !s.code?.source?.trim())
        p.push(`Etapa ${i + 1}: kind code sem code.source.`);
      if (s.kind === 'exercise' && !s.exercise?.trim())
        p.push(`Etapa ${i + 1}: kind exercise sem o enunciado (exercise).`);
      (s.quiz ?? []).forEach((q, qi) => {
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= (q.options?.length ?? 0))
          p.push(
            `Etapa ${i + 1}, questão ${qi + 1}: answer=${q.answer} fora das ${q.options?.length ?? 0} opções.`,
          );
        if (norm(q.explanation).length < 20)
          p.push(`Etapa ${i + 1}, questão ${qi + 1}: explanation curta demais.`);
      });
    });
    if (!steps.some((s) => (s.quiz?.length ?? 0) >= 2))
      p.push('Inclua um quiz com pelo menos 2 questões para verificar o entendimento.');
    p.push(
      ...checkUrls(
        sources.map((s, i) => ({ url: s.url, where: `fonte ${i + 1}` })),
        'Aula:',
      ),
    );
    return p;
  },

  add_learning_resources({ items = [] }) {
    return checkUrls(
      items.map((r, i) => ({ url: r.url, where: `recurso ${i + 1} ("${short(r.title, 40)}")` })),
      'Recursos:',
    );
  },

  add_milestones({ items = [] }) {
    const p = [];
    items.forEach((m, i) => {
      if (!m.links?.length)
        p.push(`Marco ${i + 1} ("${short(m.title, 40)}"): sem link de fonte primária.`);
      p.push(
        ...checkUrls(
          (m.links ?? []).map((l, j) => ({ url: l.url, where: `marco ${i + 1}, link ${j + 1}` })),
          'Catch-up:',
        ),
      );
    });
    return p;
  },

  add_discovered_content({ items = [] }) {
    return checkUrls(
      items.map((c, i) => ({ url: c.url, where: `item ${i + 1} ("${short(c.title, 40)}")` })),
      'Descoberta:',
    );
  },

  publish_brief({ itemIds = [], headline = '', type }) {
    const p = [];
    if (type === 'daily' && !itemIds.length)
      p.push('Daily Brief sem itemIds: escolha os 3 itens mais importantes do dia.');
    if (norm(headline).length < 8) p.push('headline vazio ou curto demais.');
    return p;
  },
};

const input = read();
const tool = input?.tool_name?.replace(/^mcp__current-brain__/, '');
const rule = tool && RULES[tool];
if (!rule) process.exit(0);

let problems = [];
try {
  problems = rule(input.tool_input ?? {});
} catch {
  process.exit(0);
}
if (problems.length) {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(
      LOG,
      JSON.stringify({ at: new Date().toISOString(), tool, problems: problems.slice(0, 15) }) +
        '\n',
    );
  } catch {}
  process.stderr.write(
    `Bloqueado pelo hook de validação do My Current Brain (${tool}). Corrija e envie de novo:\n- ${problems.slice(0, 15).join('\n- ')}\n`,
  );
  process.exit(2);
}
process.exit(0);
