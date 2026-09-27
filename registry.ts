import * as fs from 'fs';
import * as path from 'path';

import type { BrainAgentDef } from './types.js';

/** Projects with no activity for longer than this are listed but not resident. */
export const ACTIVE_PROJECT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const SECTORS: Array<{ folder: string; label: string; description: string }> = [
  {
    folder: 'agenda',
    label: 'Agenda',
    description:
      'Chefe de gabinete: calendário, tarefas do dia, lembretes, rotina e o brief diário que consolida todos os setores.',
  },
  {
    folder: 'faculdade',
    label: 'Faculdade',
    description: 'Disciplinas, provas, entregas, plano e sessões de estudo.',
  },
  {
    folder: 'pesquisa',
    label: 'Pesquisa & Tecnologia',
    description:
      'Evolução em tecnologia e pesquisa acadêmica: My Current Brain, metas de aprendizado, linhas de pesquisa, papers e a base de conhecimento.',
  },
  {
    folder: 'projetos',
    label: 'Projetos',
    description: 'Visão geral dos projetos paralelos: progresso, foco da semana e próximos passos.',
  },
  {
    folder: 'clientes',
    label: 'Clientes',
    description: 'CRM, follow-ups, propostas e entregas de clientes.',
  },
  {
    folder: 'pessoal',
    label: 'Vida Pessoal',
    description: 'Hábitos, saúde, hidratação, descanso, finanças pessoais e diário.',
  },
  {
    folder: 'casa',
    label: 'Casa',
    description: 'Cuidados da casa: limpeza, compras, contas da casa, manutenção e rotina doméstica.',
  },
];

const IGNORED_DIRS = new Set(['node_modules']);

function mtimeOrZero(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

/** Best signal of recent work in a folder without walking it: git's own
 *  bookkeeping, the manifest/README, and the directory entry itself. */
function lastActivity(dir: string): number {
  return Math.max(
    mtimeOrZero(path.join(dir, '.git', 'logs', 'HEAD')),
    mtimeOrZero(path.join(dir, '.git', 'index')),
    mtimeOrZero(path.join(dir, '.git', 'FETCH_HEAD')),
    mtimeOrZero(path.join(dir, 'package.json')),
    mtimeOrZero(path.join(dir, 'README.md')),
    mtimeOrZero(path.join(dir, 'CLAUDE.md')),
    mtimeOrZero(dir),
  );
}

function projectDescription(dir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      description?: unknown;
    };
    if (typeof pkg.description === 'string' && pkg.description.trim()) {
      return pkg.description.trim().slice(0, 200);
    }
  } catch {
    // no manifest
  }
  for (const name of ['README.md', 'CLAUDE.md']) {
    try {
      const lines = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/);
      const first = lines.find((l) => {
        const t = l.trim();
        return t && !t.startsWith('#') && !t.startsWith('```') && !t.startsWith('<') && !t.startsWith('!');
      });
      if (first) return first.replace(/^>\s*/, '').trim().slice(0, 200);
    } catch {
      // no file
    }
  }
  return '';
}

/** Sectors come from `brainLifeDir/<sector>`; projects are the other folders
 *  of `repoRoot` (the brain-life folder itself excluded). */
export function discoverAgents(
  brainLifeDir: string,
  repoRoot: string,
  now = Date.now(),
): BrainAgentDef[] {
  const defs: BrainAgentDef[] = [];

  for (const s of SECTORS) {
    const cwd = path.join(brainLifeDir, s.folder);
    if (!fs.existsSync(cwd)) continue;
    defs.push({
      key: `setor-${s.folder}`,
      kind: 'setor',
      label: s.label,
      cwd,
      folderName: s.folder,
      description: s.description,
      active: true,
    });
  }

  const brainLifeName = path.basename(brainLifeDir).toLowerCase();
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(repoRoot, { withFileTypes: true });
  } catch {
    // repo root unreadable: sectors only
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || IGNORED_DIRS.has(e.name)) continue;
    if (e.name.toLowerCase() === brainLifeName) continue;
    const cwd = path.join(repoRoot, e.name);
    const last = lastActivity(cwd);
    defs.push({
      key: `projeto-${e.name}`,
      kind: 'projeto',
      label: e.name,
      cwd,
      folderName: e.name,
      description: projectDescription(cwd),
      lastActivityAt: last || undefined,
      active: last > 0 && now - last <= ACTIVE_PROJECT_WINDOW_MS,
    });
  }

  return defs;
}
