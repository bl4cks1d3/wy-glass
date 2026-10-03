import type { AutomationNodeSpec, AutomationNodeType } from '@planner-life/shared';

/**
 * Catalogo dos nos. O editor (formularios e paleta), a validacao e o servidor MCP
 * leem daqui: para criar um tipo novo, acrescente aqui, valide em graph.ts e execute em engine.ts.
 */
export const NODE_SPECS: AutomationNodeSpec[] = [
  {
    type: 'trigger.manual',
    category: 'trigger',
    label: 'Manual',
    description:
      'Comeca quando você clica em Executar. Serve para testar e para rotinas sob demanda.',
    inputs: 0,
    outputs: ['main'],
    fields: [
      {
        key: 'payload',
        label: 'Dados de exemplo (JSON)',
        kind: 'json',
        placeholder: '{"titulo": "teste"}',
        help: 'Vira o item de entrada ao executar.',
      },
    ],
    example: { payload: {} },
  },
  {
    type: 'trigger.schedule',
    category: 'trigger',
    label: 'Agendamento',
    description:
      'Dispara em horários repetidos (cron de 5 campos, horário local): minuto hora dia-do-mês mês dia-da-semana.',
    inputs: 0,
    outputs: ['main'],
    fields: [
      {
        key: 'cron',
        label: 'Cron',
        kind: 'cron',
        required: true,
        placeholder: '0 9 * * 1',
        help: 'Ex.: 0 9 * * 1 = segunda às 9h · */15 * * * * = a cada 15 min · 0 8 * * 1-5 = dias úteis às 8h',
      },
    ],
    example: { cron: '0 9 * * 1' },
  },
  {
    type: 'trigger.once',
    category: 'trigger',
    label: 'Uma vez',
    description:
      'Dispara uma única vez numa data e hora (lembrete/temporizador). Depois se encerra.',
    inputs: 0,
    outputs: ['main'],
    fields: [
      {
        key: 'at',
        label: 'Quando',
        kind: 'datetime',
        required: true,
        placeholder: '2026-09-20T09:00',
        help: 'Data e hora local (ou ISO com fuso).',
      },
    ],
    example: { at: '2026-09-20T09:00' },
  },
  {
    type: 'trigger.event',
    category: 'trigger',
    label: 'Evento do Planner',
    description:
      'Dispara quando algo acontece no Planner (tarefa criada, registro salvo…). Os dados do evento viram o item.',
    inputs: 0,
    outputs: ['main'],
    fields: [
      { key: 'event', label: 'Evento', kind: 'event', required: true, placeholder: 'task.created' },
      {
        key: 'where',
        label: 'Só se (JSON, opcional)',
        kind: 'json',
        placeholder: '{"collection": "agua"}',
        help: 'Compara campos do payload por igualdade.',
      },
    ],
    example: { event: 'task.created' },
  },
  {
    type: 'action.tool',
    category: 'action',
    label: 'Ferramenta do Planner',
    description:
      'Chama uma ferramenta do Planner (tarefas, notas, agenda, pesquisa…) para cada item. Se devolver uma lista, cada elemento vira um item.',
    inputs: 1,
    outputs: ['main'],
    fields: [
      {
        key: 'tool',
        label: 'Ferramenta',
        kind: 'tool',
        required: true,
        placeholder: 'create_task',
      },
      {
        key: 'args',
        label: 'Argumentos (JSON)',
        kind: 'json',
        placeholder: '{"title": "{{json.title}}"}',
        help: 'Use {{json.campo}} para dados do item.',
      },
    ],
    example: { tool: 'create_task', args: { title: '{{json.title}}' } },
  },
  {
    type: 'action.notify',
    category: 'action',
    label: 'Aviso',
    description: 'Mostra um aviso (toast + notificação do sistema + som). O item passa adiante.',
    inputs: 1,
    outputs: ['main'],
    fields: [
      { key: 'title', label: 'Título', kind: 'text', placeholder: 'Lembrete' },
      {
        key: 'message',
        label: 'Mensagem',
        kind: 'textarea',
        required: true,
        placeholder: '{{json.title}} venceu',
      },
    ],
    example: { title: 'Lembrete', message: 'Hora de beber água' },
  },
  {
    type: 'action.agent',
    category: 'action',
    label: 'Perguntar ao assistente',
    description:
      'Envia um pedido em texto ao assistente de IA para cada item e devolve a resposta em `reply`. Gasta cota do modelo.',
    inputs: 1,
    outputs: ['main'],
    fields: [
      {
        key: 'prompt',
        label: 'Pedido',
        kind: 'textarea',
        required: true,
        placeholder: 'Resuma: {{json.text}}',
      },
    ],
    example: { prompt: 'Resuma em uma frase: {{json.title}}' },
  },
  {
    type: 'action.record',
    category: 'action',
    label: 'Salvar registro',
    description:
      'Cria um registro numa coleção do banco sob medida (os blocos do dashboard mostram). Devolve o registro criado.',
    inputs: 1,
    outputs: ['main'],
    fields: [
      { key: 'collection', label: 'Coleção', kind: 'collection', required: true },
      {
        key: 'data',
        label: 'Campos (JSON)',
        kind: 'json',
        required: true,
        placeholder: '{"nome": "{{json.title}}"}',
      },
    ],
    example: { collection: 'agua', data: { quando: '{{now.iso}}' } },
  },
  {
    type: 'data.records',
    category: 'data',
    label: 'Ler registros',
    description: 'Lê registros de uma coleção (uma vez por execução); cada registro vira um item.',
    inputs: 1,
    outputs: ['main'],
    fields: [
      { key: 'collection', label: 'Coleção', kind: 'collection', required: true },
      {
        key: 'where',
        label: 'Filtro (JSON, opcional)',
        kind: 'json',
        placeholder: '{"pago": false}',
      },
      { key: 'q', label: 'Busca (opcional)', kind: 'text' },
      { key: 'limit', label: 'Limite', kind: 'number', placeholder: '100' },
    ],
    example: { collection: 'agua', limit: 100 },
  },
  {
    type: 'logic.if',
    category: 'logic',
    label: 'Se / Senão',
    description:
      "Separa os itens: os que cumprem a condição saem por 'verdadeiro', os outros por 'falso'.",
    inputs: 1,
    outputs: ['true', 'false'],
    fields: [
      {
        key: 'condition',
        label: 'Condição',
        kind: 'condition',
        required: true,
        placeholder: 'json.title contains "urgente"',
        help: 'Operadores: == != > >= < <= contains && || ! ( )',
      },
    ],
    example: { condition: 'json.title contains "urgente"' },
  },
  {
    type: 'logic.set',
    category: 'logic',
    label: 'Definir campos',
    description:
      "Acrescenta ou troca campos do item (aceita {{ }}). Com 'só estes campos', descarta o resto.",
    inputs: 1,
    outputs: ['main'],
    fields: [
      {
        key: 'values',
        label: 'Campos (JSON)',
        kind: 'json',
        required: true,
        placeholder: '{"texto": "Olá {{json.name | upper}}"}',
      },
      { key: 'only', label: 'Só estes campos', kind: 'select', options: ['nao', 'sim'] },
    ],
    example: { values: { texto: 'Olá {{json.name}}' } },
  },
  {
    type: 'note',
    category: 'note',
    label: 'Nota',
    description: 'Comentário no desenho (não executa). Use para explicar o que cada parte faz.',
    inputs: 0,
    outputs: [],
    fields: [{ key: 'text', label: 'Texto', kind: 'textarea' }],
    example: { text: 'Explique aqui o que este grupo de nós faz.' },
  },
];

const BY_TYPE = new Map<string, AutomationNodeSpec>(NODE_SPECS.map((s) => [s.type, s]));

export function specOf(type: string): AutomationNodeSpec | undefined {
  return BY_TYPE.get(type);
}

export const NODE_TYPES = NODE_SPECS.map((s) => s.type) as AutomationNodeType[];
export const isTrigger = (type: string) => type.startsWith('trigger.');
