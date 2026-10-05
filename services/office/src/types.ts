/** Brain Office: resident Claude agents (one per life sector and per active
 *  project) that the user talks to from the in-office control panel. */

/** Only life-management sectors are resident; projects appear in the office
 *  through their own Claude Code sessions, not as brain agents. */
export type BrainAgentKind = 'setor';

/** 'supervisionado': file edits in the agent's folder are auto-approved, every
 *  other gated tool waits for the user in the panel. 'autonomo': Claude Code's
 *  auto mode (a classifier approves or denies each gated call). */
export type Autonomy = 'supervisionado' | 'autonomo';

export type AgentRunStatus = 'ocioso' | 'trabalhando' | 'aguardando_aprovacao';

export interface BrainAgentDef {
  /** Stable id, safe in URLs: `setor-agenda`. */
  key: string;
  kind: BrainAgentKind;
  label: string;
  cwd: string;
  /** Basename of cwd — what the office maps to an area. */
  folderName: string;
  description: string;
  /** Resident unless disabled from the panel. */
  active: boolean;
  /** Periodic self-started run. It is analysis only: routine runs get no
   *  file-editing or shell tools, so they can report but never change anything. */
  routine?: { everyMinutes: number; name: string; prompt: string };
  /** Every gated tool, file edits included, waits for the user's approval. */
  approveEveryChange?: boolean;
}

export interface AgentPersistedState {
  sessionId?: string;
  /** True once a run produced a transcript, so the next run resumes it. */
  started?: boolean;
  residentId: number;
  autonomy: Autonomy;
  /** Manually activated/deactivated from the panel; overrides `active`. */
  enabled?: boolean;
  lastRoutineAt?: number;
  routinePaused?: boolean;
  /** Model alias for this agent's runs; unset = the global setting. */
  model?: string;
  /** Standing approvals the user granted from the panel. */
  allowRules?: AllowRule[];
}

/** "Sempre permitir": a gated call matching it skips the approval prompt.
 *  Shell tools match a command prefix (never a command chaining others);
 *  file tools match a path prefix; other tools match by name alone. */
export interface AllowRule {
  id: string;
  tool: string;
  pattern?: string;
  createdAt: number;
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
  /** Per-agent daily ceiling (API-equivalent USD) for routine runs; once an
   *  agent's routines spent it today, its next cycles are skipped. Unset = no cap. */
  routineDailyCostCap?: number;
  /** Model for routine cycles: an alias, or 'agente' to use the agent's own. */
  routineModel: string;
  /** Hold routines and agent-to-agent calls when the weekly pace projects
   *  the plan running out before the reset. */
  paceGuard: boolean;
}

/** One finished run, as the SDK's result message reports it. `costUsd` is the
 *  API-equivalent price: on a subscription it measures share of the plan. */
export interface RunRecord {
  ts: number;
  agent: string;
  origin: RunOrigin['kind'];
  routine?: string;
  ok: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  turns: number;
  durationMs: number;
}

export interface ConsumptionRow {
  agent: string;
  runs: number;
  costUsd: number;
  tokens: number;
  routineCostUsd: number;
}

export interface Consumption {
  today: ConsumptionRow[];
  week: ConsumptionRow[];
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
  /** Weekly pace at fetch time; absent early in the window, when a projection
   *  from a few hours of data would be noise. */
  pace?: UsagePace;
}

export interface UsagePace {
  /** Percent the week would reach at reset if spending continues linearly. */
  projected: number;
  /** When the plan runs out at this pace (ms epoch), or null if not before reset. */
  exhaustsAt: number | null;
}

/** Why the governor is holding runs back, or null when runs flow freely.
 *  'ritmo_alto' and 'uso_desconhecido' act like the soft limit. */
export type GuardState =
  null | 'pausado' | 'limite_suave' | 'limite_rigido' | 'ritmo_alto' | 'uso_desconhecido';

export interface QueueItemView {
  id: string;
  agent: string;
  origin: RunOrigin['kind'];
  /** peer: who asked; rotina: routine name. */
  detail?: string;
  preview: string;
  queuedAt: number;
  /** Why it hasn't started: the guard state, 'vagas' or 'agente_ocupado'. */
  reason: string;
}

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
  'pergunta' | 'resposta' | 'aviso' | 'pedido' | 'decisao' | 'brief' | 'lembrete' | 'recepcao';

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
  /** The standing rule "sempre permitir" would create for this call. */
  suggestedRule?: Omit<AllowRule, 'id' | 'createdAt'>;
}

export interface AgentView extends BrainAgentDef {
  residentId: number | null;
  autonomy: Autonomy;
  model?: string;
  allowRules: AllowRule[];
  status: AgentRunStatus;
  activity?: string;
  queued: number;
  started: boolean;
  routinePaused: boolean;
  lastRoutineAt?: number;
  nextRoutineAt?: number;
}

export type BrainEvent =
  | { type: 'chat'; entry: ChatEntry }
  | { type: 'status'; agent: string; status: AgentRunStatus; activity?: string; queued: number }
  | { type: 'permission'; request: PermissionRequestView }
  | { type: 'permissionResolved'; id: string; allowed: boolean }
  | { type: 'board'; post: BoardPost }
  | { type: 'boardCleared' }
  | { type: 'boardRemoved'; id: string }
  | { type: 'brief'; brief: Omit<Brief, 'markdown'> }
  | { type: 'usage'; usage: UsageSnapshot; guard: GuardState }
  | { type: 'settings'; settings: BrainSettings }
  | { type: 'nudge'; nudge: Nudge }
  | { type: 'reminders' }
  | { type: 'routed'; agent: string; reason: string }
  | { type: 'run'; record: RunRecord }
  | { type: 'queue' }
  | { type: 'hoje' }
  | { type: 'agents' };

/** Who triggered a run: the user from the panel, another agent via
 *  `perguntar_agente`, or the scheduler. `depth` counts agent-to-agent hops. */
export type RunOrigin =
  | { kind: 'user'; force?: boolean }
  | { kind: 'peer'; from: string; depth: number }
  | { kind: 'rotina'; name: string };
