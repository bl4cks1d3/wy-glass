import * as fs from 'fs';
import * as path from 'path';

import type { BrainAgentDef } from './types.js';

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
    description:
      'Cuidados da casa: limpeza, compras, contas da casa, manutenção e rotina doméstica.',
  },
];

const EVOLUTION_EVERY_MINUTES = 6 * 60;

const EVOLUTION_PROMPT = [
  'Ciclo de evolução do escritório (este repositório: brain-agents, o escritório em pixel art com os agentes do usuário).',
  'Neste ciclo você só ANALISA: não tem ferramentas de edição nem de terminal, e não deve tentar alterar nada.',
  '1. Leia o mural recente com mcp__escritorio__ler_mural para não repetir propostas já feitas.',
  '2. Olhe o código com foco em server/src/brain e webview-ui/src/brain (o que foi construído por último), o git log e o CLAUDE.md.',
  '3. Procure falhas reais (bugs, condições de corrida, erros de tipo, estados inconsistentes, segurança) e melhorias de maior valor para o uso diário do usuário (UX do painel, agentes, lembretes, brief).',
  '4. Publique no máximo 3 propostas com mcp__escritorio__publicar_no_mural (tipo "pedido", título "Proposta: <resumo>"). Em cada uma: problema, evidência (arquivo:linha), solução, risco e esforço.',
  '5. Responda com um resumo curto. O usuário decide o que implementar pedindo no seu chat; aí cada alteração passa pela aprovação dele.',
].join('\n');

/** The office's resident agents are the life-management sectors in
 *  `brainLifeDir/<sector>` (each folder holds that sector's CLAUDE.md and MCP
 *  config). Projects get no resident agent: a project shows up in the office
 *  only while the user runs a Claude Code session in it. With `officeRepoDir`
 *  (the brain-agents checkout) an Evolution agent proposes improvements to it. */
export function discoverAgents(brainLifeDir: string, officeRepoDir?: string): BrainAgentDef[] {
  const defs: BrainAgentDef[] = [];

  if (officeRepoDir && fs.existsSync(officeRepoDir)) {
    defs.push({
      key: 'setor-evolucao',
      kind: 'setor',
      label: 'Evolução',
      cwd: officeRepoDir,
      folderName: path.basename(officeRepoDir),
      description:
        'Evolui o próprio escritório: a cada ciclo analisa o código e propõe melhorias no mural; implementa só o que você pedir, com sua aprovação a cada alteração.',
      active: true,
      routine: {
        everyMinutes: EVOLUTION_EVERY_MINUTES,
        name: 'ciclo de evolução',
        prompt: EVOLUTION_PROMPT,
      },
      approveEveryChange: true,
    });
  }

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

  return defs;
}
