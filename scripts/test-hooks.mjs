// Runs the validation hook against good and bad payloads. Usage: node scripts/test-hooks.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../.claude/hooks/validate-brain.mjs', import.meta.url));
const run = (tool, input) =>
  spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: `mcp__current-brain__${tool}`, tool_input: input }),
    encoding: 'utf8',
  });

const generic =
  'Irrelevante ao stack/interesses do usuário (cultura, retro computing, finanças, segurança fora do stack)';
const good = {
  id: 'a1b2c3d4',
  area: 'now',
  category: 'TOOL',
  priority: 'P1',
  summary:
    'O Taskflow Agent do GitHub Security Lab executa fluxos de auditoria de ponta a ponta usando ferramentas MCP.',
  whyItMatters:
    'Mostra uma arquitetura de agente via MCP parecida com o brain-curator do seu projeto My Current Brain.',
  keyPoints: ['Fluxos declarativos', 'Ferramentas MCP com escopo'],
  tags: ['AI', 'MCP'],
  readMinutes: 6,
};

const CASES = [
  ['save_content_analysis', 'análise completa', { items: [good] }, 0],
  ['save_content_analysis', 'summary vazio', { items: [{ ...good, summary: '' }] }, 2],
  ['save_content_analysis', 'P1 sem keyPoints', { items: [{ ...good, keyPoints: [] }] }, 2],
  [
    'save_content_analysis',
    'whyItMatters igual ao summary',
    { items: [{ ...good, whyItMatters: good.summary }] },
    2,
  ],
  ['save_content_analysis', 'frontier sem maturity', { items: [{ ...good, area: 'frontier' }] }, 2],
  [
    'save_content_analysis',
    "mesmo 'por que' em 3 itens",
    { items: [good, { ...good, id: 'b' }, { ...good, id: 'c' }] },
    2,
  ],
  [
    'ignore_content',
    'motivo por item',
    {
      items: [
        { id: 'x1', reason: 'Notícia sobre política europeia, sem relação com a sua stack' },
        { id: 'x2', reason: 'Paper de biologia computacional, fora dos seus temas' },
      ],
    },
    0,
  ],
  [
    'ignore_content',
    'motivo genérico repetido (o do seu banco)',
    { items: [1, 2, 3].map((n) => ({ id: `y${n}`, reason: generic })) },
    2,
  ],
  ['ignore_content', 'legado: ids + 1 motivo', { ids: ['z1', 'z2'], reason: generic }, 2],
  [
    'write_lesson',
    'aula rasa + quiz inválido',
    {
      steps: [
        { name: 'Conceito', kind: 'concept', minutes: 3, body: 'Curto.' },
        {
          name: 'Quiz',
          kind: 'quiz',
          minutes: 1,
          body: 'x'.repeat(90),
          quiz: [
            {
              question: '?',
              options: ['a', 'b'],
              answer: 5,
              explanation: 'porque sim, obviamente',
            },
          ],
        },
      ],
      sources: [{ title: 'x', url: 'https://docs.example.com' }],
    },
    2,
  ],
  [
    'add_learning_resources',
    'URL de busca do YouTube',
    {
      items: [
        { kind: 'video', title: 'Rust', url: 'https://www.youtube.com/results?search_query=rust' },
      ],
    },
    2,
  ],
  [
    'add_learning_resources',
    'URL real',
    { items: [{ kind: 'docs', title: 'The Rust Book', url: 'https://doc.rust-lang.org/book/' }] },
    0,
  ],
  [
    'add_milestones',
    'marco sem fonte',
    { items: [{ topic: 'Next.js', title: 'Next 16', links: [] }] },
    2,
  ],
  ['get_context', 'tool de leitura não é validada', {}, 0],
];

let failed = 0;
for (const [tool, name, input, expected] of CASES) {
  const r = run(tool, input);
  const pass = r.status === expected;
  if (!pass) failed++;
  console.log(
    `${pass ? '✓' : '✗'} ${tool.padEnd(24)} ${name.padEnd(44)} exit ${r.status}${expected === 2 && pass ? `  → ${r.stderr.split('\n')[1]?.slice(2, 110)}` : ''}`,
  );
}
console.log(failed ? `\n${failed} falharam` : `\n${CASES.length} casos ok`);
process.exit(failed ? 1 : 0);
