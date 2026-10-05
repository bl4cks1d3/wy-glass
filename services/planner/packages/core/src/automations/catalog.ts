import type { PlpEventType } from '@planner-life/shared';

export interface EventInfo {
  type: PlpEventType;
  module: string;
  /** Campos de trigger.payload (as ids; para o resto, use uma ferramenta de leitura no primeiro passo). */
  payload: string[];
}

/** Eventos que o Core realmente emite hoje e que servem de gatilho. */
export const EVENT_CATALOG: EventInfo[] = [
  { type: 'task.created', module: 'Tarefas', payload: ['taskId', 'title'] },
  { type: 'task.updated', module: 'Tarefas', payload: ['taskId', 'status?'] },
  { type: 'task.completed', module: 'Tarefas', payload: ['taskId', 'status'] },
  { type: 'task.deleted', module: 'Tarefas', payload: ['taskId'] },
  { type: 'project.created', module: 'Projetos', payload: ['projectId', 'name'] },
  { type: 'project.updated', module: 'Projetos', payload: ['projectId', 'progress'] },
  { type: 'project.deleted', module: 'Projetos', payload: ['projectId'] },
  { type: 'client.created', module: 'CRM', payload: ['clientId', 'name'] },
  { type: 'client.updated', module: 'CRM', payload: ['clientId', 'stage'] },
  { type: 'client.deleted', module: 'CRM', payload: ['clientId'] },
  { type: 'subject.created', module: 'Estudos', payload: ['subjectId', 'name'] },
  { type: 'subject.updated', module: 'Estudos', payload: ['subjectId', 'progress'] },
  { type: 'subject.deleted', module: 'Estudos', payload: ['subjectId'] },
  { type: 'study_topic.created', module: 'Estudos', payload: ['topicId', 'subjectId'] },
  { type: 'study_topic.updated', module: 'Estudos', payload: ['topicId', 'done'] },
  { type: 'study_topic.deleted', module: 'Estudos', payload: ['topicId'] },
  {
    type: 'study_session.created',
    module: 'Estudos',
    payload: ['sessionId', 'subjectId', 'durationMinutes'],
  },
  { type: 'study_session.deleted', module: 'Estudos', payload: ['sessionId'] },
  { type: 'schedule_block.created', module: 'Estudos', payload: ['blockId', 'subjectId'] },
  { type: 'schedule_block.deleted', module: 'Estudos', payload: ['blockId'] },
  { type: 'research_line.created', module: 'Pesquisa', payload: ['lineId', 'name'] },
  { type: 'research_line.updated', module: 'Pesquisa', payload: ['lineId', 'stage'] },
  { type: 'research_line.deleted', module: 'Pesquisa', payload: ['lineId'] },
  { type: 'paper.created', module: 'Pesquisa', payload: ['paperId', 'title'] },
  { type: 'paper.updated', module: 'Pesquisa', payload: ['paperId', 'status?', 'notePath?'] },
  { type: 'paper.deleted', module: 'Pesquisa', payload: ['paperId'] },
  { type: 'habit.created', module: 'Hábitos', payload: ['habitId', 'name'] },
  { type: 'habit.updated', module: 'Hábitos', payload: ['habitId', 'current'] },
  { type: 'habit.deleted', module: 'Hábitos', payload: ['habitId'] },
  { type: 'message.synced', module: 'Inbox', payload: ['messageId', 'from'] },
  { type: 'message.handled', module: 'Inbox', payload: ['messageId', 'handled'] },
  { type: 'message.deleted', module: 'Inbox', payload: ['messageId?', 'count?', 'all?'] },
  { type: 'memory.created', module: 'Memória', payload: ['memoryId'] },
  { type: 'memory.deleted', module: 'Memória', payload: ['memoryId'] },
  { type: 'record.created', module: 'Banco sob medida', payload: ['collection', 'recordId'] },
  { type: 'record.updated', module: 'Banco sob medida', payload: ['collection', 'recordId'] },
  { type: 'record.deleted', module: 'Banco sob medida', payload: ['collection', 'recordId'] },
  { type: 'collection.created', module: 'Banco sob medida', payload: ['collection'] },
  { type: 'collection.updated', module: 'Banco sob medida', payload: ['collection'] },
  { type: 'collection.deleted', module: 'Banco sob medida', payload: ['collection'] },
  { type: 'block.created', module: 'Construtor', payload: ['blockId', 'name', 'source'] },
  { type: 'block.updated', module: 'Construtor', payload: ['blockId', 'approved'] },
  { type: 'block.deleted', module: 'Construtor', payload: ['blockId'] },
  { type: 'automation.created', module: 'Automações', payload: ['automationId', 'name', 'source'] },
  { type: 'automation.updated', module: 'Automações', payload: ['automationId', 'approved'] },
  { type: 'automation.deleted', module: 'Automações', payload: ['automationId'] },
];

export const EVENT_TYPES = new Set<string>(EVENT_CATALOG.map((e) => e.type));

/** Ferramentas que uma automacao nunca chama (mesma regra dos blocos). */
export const BLOCKED_TOOLS = new Set(['run_claude_code', 'use_skill']);

/** Ferramentas de leitura: na simulacao (dryRun) so estas rodam de verdade. */
export function isReadOnlyTool(name: string): boolean {
  return /^(list|get|read|search|check|find)_/.test(name);
}

export const LIMITS = {
  /** Itens por no (o excedente e cortado com aviso). */
  items: 500,
  /** Chamadas de ferramenta/aviso/registro por execucao (somando os itens de todos os nos). */
  invocations: 500,
  runMs: 5 * 60_000,
  definitionChars: 200_000,
  /** Disparos automaticos em 5 min antes do disjuntor desligar a automacao. */
  triggerBurst: 50,
  /** Execucoes simultaneas em toda a aplicacao. */
  concurrentRuns: 5,
  problemsShown: 15,
  /** Amostra de itens guardada por no no historico. */
  sampleItems: 5,
  sampleChars: 2000,
};
