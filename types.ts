/** Brain Office: resident Claude agents (one per life sector and per active
 *  project) that the user talks to from the in-office control panel. */

export type BrainAgentKind = 'setor' | 'projeto';

/** 'supervisionado': file edits in the agent's folder are auto-approved, every
 *  other gated tool waits for the user in the panel. 'autonomo': Claude Code's
 *  auto mode (a classifier approves or denies each gated call). */
export type Autonomy = 'supervisionado' | 'autonomo';

export type AgentRunStatus = 'ocioso' | 'trabalhando' | 'aguardando_aprovacao';

export interface BrainAgentDef {
  /** Stable id, safe in URLs: `setor-agenda`, `projeto-currentBrain`. */
  key: string;
  kind: BrainAgentKind;
  label: string;
  cwd: string;
  /** Basename of cwd — what the office maps to an area. */
  folderName: string;
  description: string;
  /** ms epoch of the last detected activity in the folder (projects only). */
  lastActivityAt?: number;
  /** Projects inactive for longer than the window are listed but not resident. */
  active: boolean;
}

export interface AgentPersistedState {
  sessionId?: string;
  /** True once a run produced a transcript, so the next run resumes it. */
  started?: boolean;
  residentId: number;
  autonomy: Autonomy;
  /** Manually activated/deactivated from the panel; overrides `active`. */
  enabled?: boolean;
}

export interface BrainSettings {
  /** Master switch: when off, queued and new runs wait until turned back on. */
  agentsEnabled: boolean;
  /** Runs executing at once across all agents; the rest queue. */
  maxConcurrent: number;
  /** Plan-usage guard (percent). At or above `softGuard` on either window,
   *  only runs the user started directly go through (agent-to-agent calls and
   *  routines wait); at or above `hardGuard`, every run waits unless forced. */
  softGuard: number;
  hardGuard: number;
  /** Model alias passed to the SDK ('sonnet', 'opus', 'haiku'); unset = the
   *  Claude Code default. */
  model?: string;
  briefEnabled: boolean;
  /** Local time HH:MM for the automatic daily brief. */
  briefTime: string;
  /** YYYY-MM-DD of the last automatic brief, so it runs once a day. */
  lastBriefDate?: string;
  /** Optional phone push: an ntfy topic URL (https://ntfy.sh/<topic> or a
   *  self-hosted server). Unset = only in-browser notifications. */
  pushUrl?: string;
  /** Set once the starter reminders were created, so deleting them sticks. */
  remindersSeeded?: boolean;
}

/** A nudge an agent delivers on its own schedule, without calling the model:
 *  its character walks to the user's office and the text pops up + pushes. */
export interface Reminder {
  id: string;
  agent: string;
  text: string;
  /** Repeat interval in minutes; unset = fires once at `nextAt`. */
  everyMinutes?: number;
  /** Local HH:MM window a repeating reminder is confined to. */
  windowStart?: string;
  windowEnd?: string;
  nextAt: number;
  active: boolean;
  createdAt: number;
}

export interface Nudge {
  id: string;
  ts: number;
  agent: string;
  residentId: number | null;
  text: string;
  reminderId?: string;
}

export interface UsageWindow {
  /** Percent of the window used, 0–100, or null when unknown. */
  utilization: number | null;
  resetsAt: string | null;
}

export interface UsageSnapshot {
  fetchedAt: number;
  subscription: string | null;
  available: boolean;
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  error?: string;
}

/** Why the governor is holding runs back, or null when runs flow freely. */
export type GuardState = null | 'pausado' | 'limite_suave' | 'limite_rigido';

export interface BrainState {
  agents: Record<string, AgentPersistedState>;
  nextResidentId: number;
  settings: BrainSettings;
}

export type ChatRole = 'user' | 'agent' | 'tool' | 'peer_in' | 'system' | 'error' | 'lembrete';

export interface ChatEntry {
  id: string;
  ts: number;
  agent: string;
  role: ChatRole;
  text: string;
  /** peer_in: the agent key that sent the message. */
  from?: string;
}

export type BoardKind =
  | 'pergunta'
  | 'resposta'
  | 'aviso'
  | 'pedido'
  | 'decisao'
  | 'brief'
  | 'lembrete'
  | 'recepcao';

export interface BoardPost {
  id: string;
  ts: number;
  kind: BoardKind;
  from: string;
  to?: string;
  title?: string;
  text: string;
}

export interface Brief {
  id: string;
  ts: number;
  from: string;
  title: string;
  markdown: string;
}

export interface PermissionRequestView {
  id: string;
  ts: number;
  agent: string;
  toolName: string;
  summary: string;
  input: Record<string, unknown>;
}

export interface AgentView extends BrainAgentDef {
  residentId: number | null;
  autonomy: Autonomy;
  status: AgentRunStatus;
  activity?: string;
  queued: number;
  started: boolean;
}

export type BrainEvent =
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'status'; agent: string; status: AgentRunStatus; activity?: string; queued: number }
  | { type: 'permission'; request: PermissionRequestView }
  | { type: 'permissionResolved'; id: string; allowed: boolean }
  | { type: 'board'; post: BoardPost }
  | { type: 'brief'; brief: Omit<Brief, 'markdown'> }
  | { type: 'usage'; usage: UsageSnapshot; guard: GuardState }
  | { type: 'settings'; settings: BrainSettings }
  | { type: 'nudge'; nudge: Nudge }
  | { type: 'reminders' }
  | { type: 'routed'; agent: string; reason: string }
  | { type: 'agents' };

/** Who triggered a run: the user from the panel, another agent via
 *  `perguntar_agente`, or the scheduler. `depth` counts agent-to-agent hops. */
export type RunOrigin =
  | { kind: 'user'; force?: boolean }
  | { kind: 'peer'; from: string; depth: number }
  | { kind: 'rotina'; name: string };
