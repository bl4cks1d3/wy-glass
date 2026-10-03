export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface Project {
  id: string;
  name: string;
  goal?: string;
  progress: number; // 0-100
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  projectId?: string;
  status: TaskStatus;
  dueAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  source: string; // e.g. "personal-agent", "user"
  createdAt: string;
}

export type ClientStage = "lead" | "contact" | "proposal" | "closed";

export interface Client {
  id: string;
  name: string;
  stage: ClientStage;
  value: number;
  nextAction?: string;
  nextActionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subject {
  id: string;
  name: string;
  progress: number; // 0-100
  note?: string;
  examDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudyTopic {
  id: string;
  subjectId: string;
  title: string;
  done: boolean;
  /** Se preenchida, o topico vira uma "entrega/leitura" com prazo (nativo
   * de Estudos -- nao depende de tarefa/projeto nenhum). */
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleBlock {
  id: string;
  subjectId: string;
  dayOfWeek: number; // 0 = domingo .. 6 = sabado
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  createdAt: string;
}

export interface StudySession {
  id: string;
  subjectId?: string;
  durationMinutes: number;
  startedAt: string;
  endedAt: string;
  createdAt: string;
}

export interface ResearchLine {
  id: string;
  name: string;
  stage?: string;
  refs: number;
  nextStep?: string;
  createdAt: string;
  updatedAt: string;
}

export type PaperStatus = "na_fila" | "em_leitura" | "resumido";

export interface Paper {
  id: string;
  title: string;
  source?: string;
  status: PaperStatus;
  researchLineId?: string;
  notePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  name: string;
  unit: string;
  target: number;
  current: number;
  createdAt: string;
  updatedAt: string;
}

export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  snippet?: string;
  tag?: string;
  action?: string;
  handled: boolean;
  receivedAt: string;
  createdAt: string;
}

export interface PlannerEvent {
  id: string;
  type: PlpEventType;
  payload: Record<string, unknown>;
  origin: string; // node name that produced the event
  createdAt: string;
}

export type PlpEventType =
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.deleted"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "memory.created"
  | "memory.deleted"
  | "client.created"
  | "client.updated"
  | "client.deleted"
  | "subject.created"
  | "subject.updated"
  | "subject.deleted"
  | "research_line.created"
  | "research_line.updated"
  | "research_line.deleted"
  | "paper.created"
  | "paper.updated"
  | "paper.deleted"
  | "habit.created"
  | "habit.updated"
  | "habit.deleted"
  | "message.synced"
  | "message.handled"
  | "message.deleted"
  | "study_topic.created"
  | "study_topic.updated"
  | "study_topic.deleted"
  | "schedule_block.created"
  | "schedule_block.deleted"
  | "study_session.created"
  | "study_session.deleted"
  | "block.created"
  | "block.updated"
  | "block.deleted"
  | "dashboard.created"
  | "dashboard.updated"
  | "dashboard.deleted"
  | "collection.created"
  | "collection.updated"
  | "collection.deleted"
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "workspace.created"
  | "workspace.updated"
  | "workspace.deleted"
  | "automation.created"
  | "automation.updated"
  | "automation.deleted"
  | "agent.started"
  | "agent.finished"
  | "device.connected"
  | "device.disconnected"
  | "message.received";

/** Permissoes que um bloco declara: o dashboard so deixa o codigo do bloco
 * tocar no que estiver listado aqui (e o bloco estiver aprovado). */
export interface BlockPermissions {
  read: string[];
  write: string[];
  tools: string[];
}

export type BlockSource = "builtin" | "user" | "agent";

/** Bloco = HTML + CSS + uma funcao JS de integracao (planner.main). */
export interface Block {
  id: string;
  name: string;
  description?: string;
  html: string;
  css: string;
  js: string;
  permissions: BlockPermissions;
  /** 0 = so carrega uma vez; senao, reexecuta a funcao a cada N segundos. */
  refreshSeconds: number;
  source: BlockSource;
  /** Bloco de agente/importado so acessa dados depois que o usuario aprova. */
  approved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DashboardMode = "grid" | "canvas";

/** Um bloco posicionado: "grid" em celulas (12 colunas) e "canvas" em pixels. */
export interface DashboardItem {
  id: string;
  blockId: string;
  grid: Rect;
  canvas: Rect;
}

export interface Dashboard {
  id: string;
  name: string;
  mode: DashboardMode;
  items: DashboardItem[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CollectionFieldType = "text" | "longtext" | "number" | "date" | "boolean" | "select";

export interface CollectionField {
  name: string;
  label?: string;
  type: CollectionFieldType;
  required?: boolean;
  /** Obrigatorio quando type = "select". */
  options?: string[];
}

/** Tabela definida pelo usuario (ou pelo Claude): o "banco de dados" sob medida. */
export interface Collection {
  id: string;
  name: string;
  label: string;
  description?: string;
  fields: CollectionField[];
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceNodeType = "terminal" | "block" | "note" | "automation";

/** Um item no canvas do workspace. x/y/w/h em unidades do mundo (zoom 1). */
export interface WorkspaceNode {
  id: string;
  type: WorkspaceNodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** terminal: {sessionId, profile, title?} | block: {blockId} | note: {text} */
  data: Record<string, unknown>;
}

export interface WorkspaceViewport {
  x: number;
  y: number;
  zoom: number;
}

/** Canvas persistente (terminais, blocos e notas lado a lado). */
export interface Workspace {
  id: string;
  name: string;
  nodes: WorkspaceNode[];
  viewport: WorkspaceViewport;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Automacoes (estilo n8n): grafo de nos ligados por fios. Cada no recebe uma
// lista de itens (objetos JSON) e entrega itens por uma ou mais portas.
// ---------------------------------------------------------------------------

export type AutomationSource = "user" | "agent";

export type AutomationNodeType =
  | "trigger.manual"
  | "trigger.schedule"
  | "trigger.once"
  | "trigger.event"
  | "action.tool"
  | "action.notify"
  | "action.agent"
  | "action.record"
  | "data.records"
  | "logic.if"
  | "logic.set"
  | "note";

export interface AutomationNode {
  /** a-z, 0-9 e _ (usado em {{nodes.<id>.items}}). */
  id: string;
  type: AutomationNodeType;
  name: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
  /** "stop" (padrao): o erro interrompe a execucao; "continue": descarta o item e segue. */
  onError?: "stop" | "continue";
}

export interface AutomationEdge {
  id: string;
  from: string;
  /** Porta de saida do no de origem ("main"; "true"/"false" no Se). */
  fromPort: string;
  to: string;
}

export interface Automation {
  id: string;
  name: string;
  description?: string;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  /** Ligada = gatilhos automaticos (agenda, evento) disparam sozinhos. So o usuario liga. */
  active: boolean;
  source: AutomationSource;
  lastRunAt?: string;
  lastStatus?: AutomationRunStatus;
  /** Calculado na listagem: proximo disparo (agenda/uma vez), ISO. */
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus = "ok" | "partial" | "error" | "skipped";
export type AutomationNodeStatus = "ok" | "error" | "skipped" | "simulated";

export interface AutomationNodeLog {
  nodeId: string;
  name: string;
  type: AutomationNodeType;
  status: AutomationNodeStatus;
  itemsIn: number;
  /** Itens entregues por porta. */
  itemsOut: Record<string, number>;
  /** Amostra (cortada) do que entrou e do que saiu por porta. */
  input?: unknown[];
  output?: Record<string, unknown[]>;
  error?: string;
  /** Itens que falharam (onError = continue). */
  failed?: number;
  warnings?: string[];
  durationMs: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  /** "dry" = simulacao: so ferramentas de leitura rodam de verdade. */
  mode: "live" | "dry";
  triggerNodeId: string;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  nodes: AutomationNodeLog[];
  error?: string;
  startedAt: string;
  finishedAt: string;
}

export type AutomationFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "cron"
  | "datetime"
  | "json"
  | "tool"
  | "event"
  | "collection"
  | "condition"
  | "kv";

export interface AutomationFieldSpec {
  key: string;
  label: string;
  kind: AutomationFieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
}

/** Catalogo dos tipos de no (o editor e o MCP leem daqui). */
export interface AutomationNodeSpec {
  type: AutomationNodeType;
  category: "trigger" | "action" | "logic" | "data" | "note";
  label: string;
  description: string;
  inputs: 0 | 1;
  outputs: string[];
  fields: AutomationFieldSpec[];
  example: Record<string, unknown>;
}
