const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:4000";
const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:4100";
const VOICE_API_URL = process.env.NEXT_PUBLIC_VOICE_API_URL ?? "http://localhost:4200";
const P2P_HTTP_URL = process.env.NEXT_PUBLIC_P2P_HTTP_URL ?? "http://localhost:4401";

export interface Project {
  id: string;
  name: string;
  goal?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "pending" | "in_progress" | "done" | "cancelled";

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

export interface PlannerEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  origin: string;
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
  progress: number;
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
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleBlock {
  id: string;
  subjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
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

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  source: string;
  createdAt: string;
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

export async function getProjects(): Promise<Project[]> {
  const res = await fetch(`${CORE_API_URL}/projects`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar projetos do Planner Core");
  return res.json();
}

export async function getTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]> {
  const params = new URLSearchParams((filter ?? {}) as Record<string, string>).toString();
  const res = await fetch(`${CORE_API_URL}/tasks${params ? `?${params}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar tarefas do Planner Core");
  return res.json();
}

export async function getMemory(limit = 100): Promise<MemoryEntry[]> {
  const res = await fetch(`${CORE_API_URL}/memory?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar memoria");
  return res.json();
}

export async function createMemory(input: { content: string; tags?: string[] }): Promise<MemoryEntry> {
  const res = await fetch(`${CORE_API_URL}/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao salvar memoria");
  return res.json();
}

export async function deleteMemory(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/memory/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir memoria");
}

export async function getEvents(limit = 20): Promise<PlannerEvent[]> {
  const res = await fetch(`${CORE_API_URL}/events?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar eventos do Planner Core");
  return res.json();
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
  const res = await fetch(`${CORE_API_URL}/tasks/${taskId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("falha ao atualizar tarefa");
  return res.json();
}

export async function createTask(input: {
  title: string;
  projectId?: string;
  dueAt?: string;
  notes?: string;
}): Promise<Task> {
  const res = await fetch(`${CORE_API_URL}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar tarefa");
  return res.json();
}

export async function updateTask(
  taskId: string,
  input: { title?: string; projectId?: string | null; dueAt?: string | null; notes?: string | null }
): Promise<Task> {
  const res = await fetch(`${CORE_API_URL}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar tarefa");
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/tasks/${taskId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir tarefa");
}

export async function createProject(input: { name: string; goal?: string }): Promise<Project> {
  const res = await fetch(`${CORE_API_URL}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar projeto");
  return res.json();
}

export async function updateProject(
  projectId: string,
  input: { name?: string; goal?: string; progress?: number }
): Promise<Project> {
  const res = await fetch(`${CORE_API_URL}/projects/${projectId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar projeto");
  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/projects/${projectId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir projeto");
}

export async function getClients(): Promise<Client[]> {
  const res = await fetch(`${CORE_API_URL}/clients`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar clientes do CRM");
  return res.json();
}

export async function createClient(input: {
  name: string;
  stage?: ClientStage;
  value?: number;
  nextAction?: string;
  nextActionAt?: string;
}): Promise<Client> {
  const res = await fetch(`${CORE_API_URL}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar cliente");
  return res.json();
}

export async function updateClient(
  id: string,
  input: { stage?: ClientStage; value?: number; nextAction?: string; nextActionAt?: string }
): Promise<Client> {
  const res = await fetch(`${CORE_API_URL}/clients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar cliente");
  return res.json();
}

export async function deleteClient(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/clients/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir cliente");
}

export async function getSubjects(): Promise<Subject[]> {
  const res = await fetch(`${CORE_API_URL}/subjects`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar disciplinas");
  return res.json();
}

export async function createSubject(input: { name: string; note?: string; examDate?: string }): Promise<Subject> {
  const res = await fetch(`${CORE_API_URL}/subjects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar disciplina");
  return res.json();
}

export async function updateSubject(
  id: string,
  input: { progress?: number; note?: string; examDate?: string | null }
): Promise<Subject> {
  const res = await fetch(`${CORE_API_URL}/subjects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar disciplina");
  return res.json();
}

export async function deleteSubject(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/subjects/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir disciplina");
}

export async function getStudyTopics(subjectId?: string): Promise<StudyTopic[]> {
  const params = new URLSearchParams(subjectId ? { subjectId } : {});
  const res = await fetch(`${CORE_API_URL}/study/topics?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function createStudyTopic(input: {
  subjectId: string;
  title: string;
  dueAt?: string;
}): Promise<StudyTopic> {
  const res = await fetch(`${CORE_API_URL}/study/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar topico");
  return res.json();
}

export async function setStudyTopicDone(id: string, done: boolean): Promise<StudyTopic> {
  const res = await fetch(`${CORE_API_URL}/study/topics/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ done }),
  });
  if (!res.ok) throw new Error("falha ao atualizar topico");
  return res.json();
}

export async function deleteStudyTopic(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/study/topics/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir topico");
}

export async function getSchedule(): Promise<ScheduleBlock[]> {
  const res = await fetch(`${CORE_API_URL}/study/schedule`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function createScheduleBlock(input: {
  subjectId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}): Promise<ScheduleBlock> {
  const res = await fetch(`${CORE_API_URL}/study/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar horario");
  return res.json();
}

export async function deleteScheduleBlock(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/study/schedule/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir horario");
}

export async function getStudySessions(days = 30): Promise<StudySession[]> {
  const res = await fetch(`${CORE_API_URL}/study/sessions?days=${days}`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function createStudySession(input: {
  subjectId?: string;
  durationMinutes: number;
  startedAt: string;
  endedAt: string;
}): Promise<StudySession> {
  const res = await fetch(`${CORE_API_URL}/study/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao registrar sessao de estudo");
  return res.json();
}

export async function deleteStudySession(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/study/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir sessao de estudo");
}

export async function getResearchLines(): Promise<ResearchLine[]> {
  const res = await fetch(`${CORE_API_URL}/research/lines`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar linhas de pesquisa");
  return res.json();
}

export async function createResearchLine(input: {
  name: string;
  stage?: string;
  nextStep?: string;
}): Promise<ResearchLine> {
  const res = await fetch(`${CORE_API_URL}/research/lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar linha de pesquisa");
  return res.json();
}

export async function updateResearchLine(
  id: string,
  input: { stage?: string; nextStep?: string }
): Promise<ResearchLine> {
  const res = await fetch(`${CORE_API_URL}/research/lines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar linha de pesquisa");
  return res.json();
}

export async function deleteResearchLine(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/research/lines/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir linha de pesquisa");
}

export async function getPapers(researchLineId?: string): Promise<Paper[]> {
  const params = researchLineId ? `?researchLineId=${researchLineId}` : "";
  const res = await fetch(`${CORE_API_URL}/research/papers${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar artigos");
  return res.json();
}

export async function createPaper(input: { title: string; source?: string; researchLineId?: string }): Promise<Paper> {
  const res = await fetch(`${CORE_API_URL}/research/papers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar artigo");
  return res.json();
}

export async function updatePaperStatus(id: string, status: PaperStatus): Promise<Paper> {
  const res = await fetch(`${CORE_API_URL}/research/papers/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("falha ao atualizar status do artigo");
  return res.json();
}

export async function deletePaper(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/research/papers/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir artigo");
}

export async function getMessages(): Promise<InboxMessage[]> {
  const res = await fetch(`${CORE_API_URL}/messages`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar mensagens");
  return res.json();
}

export async function createMessage(input: {
  from: string;
  subject: string;
  snippet?: string;
  tag?: string;
  action?: string;
}): Promise<InboxMessage> {
  const res = await fetch(`${CORE_API_URL}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao adicionar mensagem");
  return res.json();
}

export async function getMessageBody(
  messageId: string
): Promise<{ from: string; subject: string; text: string; html: string }> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/gmail/${encodeURIComponent(messageId)}/body`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("falha ao ler o e-mail");
  return res.json();
}

export async function setMessageHandled(messageId: string, handled: boolean): Promise<InboxMessage> {
  const res = await fetch(`${CORE_API_URL}/messages/${messageId}/handled`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handled }),
  });
  if (!res.ok) throw new Error("falha ao atualizar mensagem");
  return res.json();
}

export async function deleteMessage(messageId: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/messages/${messageId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir mensagem");
}

/** So limpa a copia local do inbox no Planner -- nunca mexe no Gmail de verdade. */
export async function clearInbox(): Promise<{ cleared: number }> {
  const res = await fetch(`${CORE_API_URL}/messages`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao limpar o inbox");
  return res.json();
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

export async function getHabits(): Promise<Habit[]> {
  const res = await fetch(`${CORE_API_URL}/habits`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao buscar habitos");
  return res.json();
}

export async function createHabit(input: { name: string; unit?: string; target?: number }): Promise<Habit> {
  const res = await fetch(`${CORE_API_URL}/habits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar habito");
  return res.json();
}

export async function updateHabit(id: string, input: { current?: number; target?: number }): Promise<Habit> {
  const res = await fetch(`${CORE_API_URL}/habits/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao atualizar habito");
  return res.json();
}

export async function deleteHabit(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/habits/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir habito");
}

export interface ServiceHealth {
  core: boolean;
  agent: boolean;
  voice: boolean;
  p2pNode: boolean;
}

async function pingHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${url}/health`, { cache: "no-store", signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getServiceHealth(): Promise<ServiceHealth> {
  const [core, agent, voice, p2pNode] = await Promise.all([
    pingHealth(CORE_API_URL),
    pingHealth(AGENT_API_URL),
    pingHealth(VOICE_API_URL),
    pingHealth(P2P_HTTP_URL),
  ]);
  return { core, agent, voice, p2pNode };
}

export interface GoogleAccount {
  email: string;
  connectedAt: string;
}

export interface GoogleStatus {
  connected: boolean;
  accounts: GoogleAccount[];
}

export const GOOGLE_CONNECT_URL = `${CORE_API_URL}/integrations/google/auth`;

export async function getGoogleStatus(): Promise<GoogleStatus> {
  try {
    const res = await fetch(`${CORE_API_URL}/integrations/google/status`, { cache: "no-store" });
    if (!res.ok) return { connected: false, accounts: [] };
    return res.json();
  } catch {
    return { connected: false, accounts: [] };
  }
}

export async function disconnectGoogleAccount(email: string): Promise<void> {
  await fetch(`${CORE_API_URL}/integrations/google/accounts/${encodeURIComponent(email)}`, {
    method: "DELETE",
  });
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  account: string;
  calendarName: string;
}

export async function getCalendarEvents(limit = 10): Promise<CalendarEvent[]> {
  try {
    const res = await fetch(`${CORE_API_URL}/integrations/google/calendar?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function createCalendarEvent(input: {
  title: string;
  start: string;
  end: string;
  description?: string;
  account?: string;
}): Promise<CalendarEvent> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/calendar/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar evento");
  return res.json();
}

export async function updateCalendarEvent(
  id: string,
  input: { title?: string; start?: string; end?: string; description?: string; account?: string }
): Promise<CalendarEvent> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/calendar/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar evento");
  return res.json();
}

export async function deleteCalendarEvent(id: string, account?: string): Promise<void> {
  const params = new URLSearchParams(account ? { account } : {});
  const res = await fetch(
    `${CORE_API_URL}/integrations/google/calendar/events/${encodeURIComponent(id)}?${params.toString()}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("falha ao excluir evento");
}

export type GoogleTaskStatus = "needsAction" | "completed";

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: GoogleTaskStatus;
  account: string;
}

export async function getGoogleTasks(): Promise<GoogleTask[]> {
  try {
    const res = await fetch(`${CORE_API_URL}/integrations/google/tasks`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function createGoogleTask(input: { title: string; notes?: string; due?: string }): Promise<GoogleTask> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao criar tarefa no Google Tasks");
  return res.json();
}

export async function updateGoogleTask(
  id: string,
  input: { title?: string; notes?: string; due?: string; status?: GoogleTaskStatus }
): Promise<GoogleTask> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("falha ao editar tarefa do Google Tasks");
  return res.json();
}

export async function deleteGoogleTask(id: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir tarefa do Google Tasks");
}

export async function syncGmail(limit = 10): Promise<{ synced: number; accounts: string[] }> {
  const res = await fetch(`${CORE_API_URL}/integrations/google/sync-gmail?limit=${limit}`, { method: "POST" });
  if (!res.ok) throw new Error("falha ao sincronizar o Gmail");
  return res.json();
}

export async function sendChat(message: string): Promise<string> {
  const res = await fetch(`${AGENT_API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("falha ao conversar com o Personal Agent");
  const data = (await res.json()) as { reply: string };
  return data.reply;
}

export interface ClaudeCodeAction {
  id: string;
  prompt: string;
  cwd: string;
  status: "pending" | "running" | "done" | "error" | "rejected";
  createdAt: string;
  output?: string;
  error?: string;
  kind?: "research";
  meta?: { theme?: string };
}

export async function getPendingClaudeCodeActions(): Promise<ClaudeCodeAction[]> {
  const res = await fetch(`${AGENT_API_URL}/claude-code/pending`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function confirmClaudeCodeAction(id: string): Promise<ClaudeCodeAction> {
  const res = await fetch(`${AGENT_API_URL}/claude-code/${id}/confirm`, { method: "POST" });
  if (!res.ok) throw new Error("falha ao confirmar o pedido do Claude Code");
  return res.json();
}

export async function rejectClaudeCodeAction(id: string): Promise<ClaudeCodeAction> {
  const res = await fetch(`${AGENT_API_URL}/claude-code/${id}/reject`, { method: "POST" });
  if (!res.ok) throw new Error("falha ao rejeitar o pedido do Claude Code");
  return res.json();
}

/** Terminal direto: roda o prompt no Claude Code na hora (sem fila de
 * aprovacao -- voce mesmo escrevendo e enviando ja e a confirmacao). Pode
 * demorar ate alguns minutos, dependendo do que o Claude Code precisar fazer. */
export async function runClaudeCode(prompt: string, cwd?: string): Promise<ClaudeCodeAction> {
  const res = await fetch(`${AGENT_API_URL}/claude-code/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, cwd }),
  });
  if (!res.ok) throw new Error("falha ao rodar o Claude Code");
  return res.json();
}

/** Cria um pedido pendente pro Claude Code pesquisar um tema de verdade --
 * ainda precisa ser confirmado no card que aparece no chat. */
export async function requestResearch(theme: string): Promise<ClaudeCodeAction> {
  const res = await fetch(`${AGENT_API_URL}/research/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  if (!res.ok) throw new Error("falha ao pedir a pesquisa");
  return res.json();
}

export async function speak(text: string): Promise<Blob> {
  const res = await fetch(`${VOICE_API_URL}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("falha ao gerar audio (voz)");
  return res.blob();
}

export interface AgentNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export async function getPendingNotifications(): Promise<AgentNotification[]> {
  try {
    const res = await fetch(`${AGENT_API_URL}/notifications/pending`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function ackNotification(id: string): Promise<void> {
  await fetch(`${AGENT_API_URL}/notifications/${id}/ack`, { method: "POST" }).catch(() => undefined);
}

export interface VaultNoteMeta {
  path: string;
  title: string;
  updatedAt: string;
  excerpt?: string;
}

export interface VaultNote extends VaultNoteMeta {
  content: string;
}

export async function getVaultNotes(): Promise<VaultNoteMeta[]> {
  const res = await fetch(`${CORE_API_URL}/vault/notes`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function getVaultNote(path: string): Promise<VaultNote> {
  const res = await fetch(`${CORE_API_URL}/vault/note?path=${encodeURIComponent(path)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("falha ao ler a nota");
  return res.json();
}

export async function saveVaultNote(path: string, content: string): Promise<VaultNoteMeta> {
  const res = await fetch(`${CORE_API_URL}/vault/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) throw new Error("falha ao salvar a nota");
  return res.json();
}

export async function deleteVaultNote(path: string): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/vault/note?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("falha ao excluir a nota");
}

export async function searchVaultNotes(query: string): Promise<VaultNoteMeta[]> {
  const res = await fetch(`${CORE_API_URL}/vault/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export interface SettingField {
  key: string;
  value: string | null;
  isSecret: boolean;
  hasValue: boolean;
}

export async function getSettings(): Promise<SettingField[]> {
  const res = await fetch(`${CORE_API_URL}/settings`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function updateSettings(updates: Record<string, string>): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("falha ao salvar configuracoes");
}
