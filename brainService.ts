import type {
  CanUseTool,
  PermissionResult,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { normalizeProjectPath } from '../../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from '../agentRuntime.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from '../constants.js';
import { startFileWatching } from '../fileWatcher.js';
import { assignPaletteIfNeeded } from '../paletteAssigner.js';
import { claudeProvider } from '../providers/index.js';
import type { AgentState } from '../types.js';
import { describeRule, ruleMatches, suggestRule } from './approvalRules.js';
import { type HojeSnapshot, readHoje, resolveIntegrationPaths } from './integrations.js';
import { LocalData, resolveVaultDir } from './localData.js';
import { BrainPersistence, type PersistedQueueItem } from './persistence.js';
import { discoverAgents } from './registry.js';
import {
  buildReminder,
  describeReminder,
  nextAfterFiring,
  type ReminderInput,
} from './reminders.js';
import { loadAgentSdk, type LoadedSdk } from './sdkLoader.js';
import type {
  AgentPersistedState,
  AgentRunStatus,
  AgentView,
  AllowRule,
  BoardKind,
  BoardPost,
  BrainAgentDef,
  BrainEvent,
  BrainSettings,
  BrainState,
  Brief,
  ChatEntry,
  ChatRole,
  Consumption,
  ConsumptionRow,
  GuardState,
  Nudge,
  PermissionRequestView,
  QueueItemView,
  Reminder,
  RunOrigin,
  RunRecord,
  UsagePace,
  UsageSnapshot,
} from './types.js';

const USAGE_POLL_MS = 5 * 60 * 1000;
const USAGE_EVENT_DEBOUNCE_MS = 30 * 1000;
const SCHEDULER_TICK_MS = 30 * 1000;
/** New, renamed and deleted project folders show up within this interval. */
const REGISTRY_RESCAN_MS = 60 * 1000;
const HOJE_REFRESH_MS = 2 * 60 * 1000;
const PLANNER_NOTICE_POLL_MS = 30_000;
const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;
const TRANSCRIPT_WAIT_MS = 30 * 1000;
/** Agent-to-agent hops allowed. A run started by another agent cannot ask a
 *  third one, so call chains (and cycles) are impossible. */
const MAX_PEER_DEPTH = 1;
const PEER_TOOL_TIMEOUT_MS = 20 * 60 * 1000;
const BRIEF_AGENT = 'setor-agenda';
const BRIEF_GRACE_MINUTES = 120;
/** Tools a routine (unattended) run never gets: it may read and report only. */
// Task/Agent too: a subagent must not become a way around the list.
const ROUTINE_BLOCKED_TOOLS = [
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
  'PowerShell',
  'Task',
  'Agent',
];
const ROUTER_FALLBACK = 'setor-agenda';
const PUSH_TIMEOUT_MS = 10_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A usage reading older than this no longer counts as known: the guard
 *  brakes like the soft limit instead of trusting a stale (or zero) number. */
const USAGE_STALE_MS = 15 * 60 * 1000;
/** Share of the week that must have passed before the pace is projected. */
const PACE_MIN_ELAPSED = 0.1;
const PACE_MIN_UTILIZATION = 10;
/** Queued messages older than this are dropped on restore, not replayed. */
const QUEUE_RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MODEL_ALIASES = ['sonnet', 'opus', 'haiku'];
const ROUTINE_MODEL_OWN = 'agente';
const PREVIEW_CHARS = 140;

/** Linear weekly projection from the current utilization and reset time. */
function computePace(win: UsageSnapshot['sevenDay'], now: number): UsagePace | undefined {
  if (!win || win.utilization === null || !win.resetsAt) return undefined;
  const resetsAt = Date.parse(win.resetsAt);
  if (!Number.isFinite(resetsAt)) return undefined;
  const elapsedMs = WEEK_MS - (resetsAt - now);
  if (elapsedMs < WEEK_MS * PACE_MIN_ELAPSED || win.utilization < PACE_MIN_UTILIZATION)
    return undefined;
  const perMs = win.utilization / elapsedMs;
  const projected = Math.round(win.utilization + perMs * (resetsAt - now));
  const exhaustsAt = now + (100 - win.utilization) / perMs;
  return { projected, exhaustsAt: exhaustsAt < resetsAt ? Math.round(exhaustsAt) : null };
}

/** Tools that never need the user's approval: reading, searching, planning,
 *  delegating to subagents and the office's own tools. */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'Task',
  'Agent',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
]);
const READ_ONLY_MCP = /^mcp__[^_].*__(list|get|read|search|check)_/;

interface Job {
  id: string;
  text: string;
  origin: RunOrigin;
  queuedAt: number;
  resolve: (reply: string) => void;
  reject: (err: Error) => void;
}

/** What one run learned from the SDK stream. */
interface RunTrack {
  /** The session initialized: a later failure is the run's, not the resume's. */
  gotInit: boolean;
  /** Routine cycles run in a throwaway session: resuming the agent's own
   *  conversation would re-read its whole history on every turn. */
  ephemeralSession?: string;
  stats?: Omit<RunRecord, 'ts' | 'agent' | 'origin' | 'routine' | 'ok'>;
}

interface PendingPermission {
  view: PermissionRequestView;
  resolve: (result: PermissionResult) => void;
}

export interface BrainServiceOptions {
  brainLifeDir: string;
  store: AgentStateStore;
  runtime: AgentRuntime;
  /** The brain-agents checkout itself, evolved by the Evolution agent. */
  officeRepoDir?: string;
  persistence?: BrainPersistence;
}

function transcriptPath(cwd: string, sessionId: string): string {
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    normalizeProjectPath(cwd),
    `${sessionId}.jsonl`,
  );
}

function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Cost and usage from a result message, read defensively: error results and
 *  older SDKs may leave fields out. */
function resultStats(m: SDKMessage): RunTrack['stats'] {
  const r = m as unknown as Record<string, unknown>;
  const u = (r.usage ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    costUsd: num(r.total_cost_usd),
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
    turns: num(r.num_turns),
    durationMs: num(r.duration_ms),
  };
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

export class BrainService {
  readonly persistence: BrainPersistence;
  /** Token-free reads and writes on Planner Life / Current Brain for the tabs. */
  readonly local: LocalData;
  private readonly events = new EventEmitter();
  private defs = new Map<string, BrainAgentDef>();
  private state: BrainState;
  private readonly queues = new Map<string, Job[]>();
  private readonly running = new Map<string, { abort: AbortController; origin: RunOrigin }>();
  /** Running agents blocked in perguntar_agente, with how many calls each. They
   *  hold no slot: the agent they wait for must be able to start. */
  private readonly awaitingPeer = new Map<string, number>();
  /** Runs of the last week, for the consumption view and the routine cap. */
  private runs: RunRecord[];
  private readonly statuses = new Map<string, { status: AgentRunStatus; activity?: string }>();
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly watchedTranscripts = new Set<string>();
  private usage: UsageSnapshot | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private usageDebounce: ReturnType<typeof setTimeout> | null = null;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private reminders: Reminder[];
  private lastRescan = Date.now();
  private hoje: HojeSnapshot | null = null;
  private hojeKey = '';
  private hojeTimer: ReturnType<typeof setInterval> | null = null;
  private plannerNoticeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: BrainServiceOptions) {
    this.persistence = opts.persistence ?? new BrainPersistence();
    const ip = resolveIntegrationPaths(this.officeDir());
    this.local = new LocalData({ ...ip, vaultDir: resolveVaultDir(ip.plannerDb) });
    this.state = this.persistence.loadState();
    this.reminders = this.persistence.loadReminders();
    this.runs = this.persistence.readRuns(Date.now() - WEEK_MS);
    this.events.setMaxListeners(100);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  start(): void {
    this.refreshRegistry();
    this.seedReminders();
    this.restoreQueue();
    void this.refreshUsage();
    this.usageTimer = setInterval(() => void this.refreshUsage(), USAGE_POLL_MS);
    this.schedulerTimer = setInterval(() => this.tickScheduler(), SCHEDULER_TICK_MS);
    void this.refreshHoje();
    this.hojeTimer = setInterval(() => void this.refreshHoje(), HOJE_REFRESH_MS);
    this.plannerNoticeTimer = setInterval(
      () => void this.relayPlannerNotices(),
      PLANNER_NOTICE_POLL_MS,
    );
    const residents = [...this.defs.values()].filter((d) => this.isResident(d)).length;
    console.log(`[Brain] ${residents} agentes residentes (${this.defs.size} descobertos)`);
  }

  dispose(): void {
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.hojeTimer) clearInterval(this.hojeTimer);
    if (this.plannerNoticeTimer) clearInterval(this.plannerNoticeTimer);
    if (this.usageDebounce) clearTimeout(this.usageDebounce);
    for (const r of this.running.values()) r.abort.abort();
  }

  onEvent(listener: (e: BrainEvent) => void): () => void {
    this.events.on('event', listener);
    return () => this.events.off('event', listener);
  }

  private emit(e: BrainEvent): void {
    this.events.emit('event', e);
  }

  /** Re-scan the sectors; create or remove resident characters. */
  refreshRegistry(): void {
    const defs = discoverAgents(this.opts.brainLifeDir, this.opts.officeRepoDir);
    const before = [...this.defs.keys()].sort().join('|');
    this.defs = new Map(defs.map((d) => [d.key, d]));
    for (const def of defs) {
      const st = this.ensureState(def.key);
      // A new routine waits one full interval (or "rodar agora") instead of
      // spending usage the moment the server starts.
      if (def.routine && st.lastRoutineAt === undefined) st.lastRoutineAt = Date.now();
      if (this.isResident(def)) this.ensureResident(def, st);
      else this.removeResident(st);
    }
    // Folder deleted or renamed: its character leaves the office. The
    // persisted state (session, autonomy) stays so a restored folder resumes.
    for (const [key, st] of Object.entries(this.state.agents)) {
      if (this.defs.has(key)) continue;
      this.stop(key);
      this.removeResident(st);
    }
    this.persistence.saveState(this.state);
    if ([...this.defs.keys()].sort().join('|') !== before) this.emit({ type: 'agents' });
  }

  private ensureState(key: string): AgentPersistedState {
    let st = this.state.agents[key];
    if (!st) {
      st = { residentId: this.state.nextResidentId++, autonomy: 'supervisionado' };
      this.state.agents[key] = st;
    }
    return st;
  }

  private isResident(def: BrainAgentDef): boolean {
    return this.state.agents[def.key]?.enabled ?? def.active;
  }

  // ── Office characters ────────────────────────────────────────

  /** A resident is an office character with no process behind it until the
   *  user (or another agent) talks to it. Not `isExternal`, so a SessionEnd at
   *  the end of each run leaves it seated instead of despawning it. */
  private ensureResident(def: BrainAgentDef, st: AgentPersistedState): void {
    const { store } = this.opts;
    if (store.has(st.residentId)) return;
    const projectDir = path.join(
      os.homedir(),
      '.claude',
      'projects',
      normalizeProjectPath(def.cwd),
    );
    const agent: AgentState = {
      id: st.residentId,
      sessionId: st.sessionId ?? `brain-${def.key}`,
      terminalRef: undefined,
      isExternal: false,
      projectDir,
      jsonlFile: '',
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: def.folderName,
      hookDelivered: false,
      contextTokens: 0,
      maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
    };
    assignPaletteIfNeeded(agent, store);
    store.set(agent.id, agent);
    if (st.sessionId) this.bindSession(def, st, true);
  }

  private removeResident(st: AgentPersistedState): void {
    const { store, runtime } = this.opts;
    const agent = store.get(st.residentId);
    if (!agent) return;
    runtime.unregisterAgent(agent.sessionId);
    runtime.removeAgent(agent.id);
  }

  /** Route this session's hooks and transcript to the resident character. */
  private bindSession(def: BrainAgentDef, st: AgentPersistedState, existing: boolean): void {
    const { store, runtime } = this.opts;
    const agent = store.get(st.residentId);
    if (!agent || !st.sessionId) return;
    const file = transcriptPath(def.cwd, st.sessionId);
    if (agent.sessionId !== st.sessionId) runtime.unregisterAgent(agent.sessionId);
    agent.sessionId = st.sessionId;
    agent.jsonlFile = file;
    runtime.knownJsonlFiles.add(file);
    runtime.registerAgent(st.sessionId, agent.id);
    if (existing) this.watchTranscript(agent, file, true);
  }

  private watchTranscript(agent: AgentState, file: string, fromEnd: boolean): void {
    if (this.watchedTranscripts.has(file)) return;
    const { store, runtime } = this.opts;
    const begin = () => {
      if (this.watchedTranscripts.has(file)) return;
      this.watchedTranscripts.add(file);
      try {
        agent.fileOffset = fromEnd ? fs.statSync(file).size : 0;
      } catch {
        agent.fileOffset = 0;
      }
      startFileWatching(
        agent.id,
        file,
        store,
        runtime.fileWatchers,
        runtime.pollingTimers,
        runtime.waitingTimers,
        runtime.permissionTimers,
      );
    };
    if (fs.existsSync(file)) {
      begin();
      return;
    }
    const deadline = Date.now() + TRANSCRIPT_WAIT_MS;
    const timer = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(timer);
        begin();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
      }
    }, 500);
  }

  private officeBroadcast(message: Record<string, unknown>): void {
    this.opts.store.broadcast(message);
  }

  // ── Views ────────────────────────────────────────────────────

  getAgents(): AgentView[] {
    return [...this.defs.values()].map((def) => {
      const st = this.ensureState(def.key);
      const s = this.statuses.get(def.key);
      return {
        ...def,
        active: this.isResident(def),
        residentId: this.opts.store.has(st.residentId) ? st.residentId : null,
        autonomy: st.autonomy,
        model: st.model,
        allowRules: st.allowRules ?? [],
        status: s?.status ?? 'ocioso',
        activity: s?.activity,
        queued: this.queues.get(def.key)?.length ?? 0,
        started: !!st.started,
        routinePaused: !!st.routinePaused,
        lastRoutineAt: st.lastRoutineAt,
        nextRoutineAt:
          def.routine && st.lastRoutineAt !== undefined
            ? st.lastRoutineAt + def.routine.everyMinutes * 60_000
            : undefined,
      };
    });
  }

  /** Pause/resume an agent's routine, or start a cycle now. */
  setRoutine(key: string, patch: { paused?: boolean; runNow?: boolean }): boolean {
    const def = this.defs.get(key);
    if (!def?.routine) return false;
    const st = this.ensureState(key);
    if (typeof patch.paused === 'boolean') st.routinePaused = patch.paused;
    if (patch.runNow) this.startRoutine(def, st, true);
    this.persistence.saveState(this.state);
    this.emit({ type: 'agents' });
    return true;
  }

  /** `manual`: "rodar agora" from the panel, which the daily cap doesn't hold. */
  private startRoutine(def: BrainAgentDef, st: AgentPersistedState, manual = false): void {
    if (!def.routine || this.running.has(def.key) || (this.queues.get(def.key)?.length ?? 0) > 0)
      return;
    st.lastRoutineAt = Date.now();
    this.persistence.saveState(this.state);
    const cap = this.state.settings.routineDailyCostCap;
    if (!manual && cap !== undefined && this.routineSpentToday(def.key) >= cap) {
      console.log(`[Brain] ${def.routine.name} pulada: teto diário de rotina atingido`);
      return;
    }
    this.send(def.key, def.routine.prompt, { kind: 'rotina', name: def.routine.name }).catch(
      (err: unknown) => {
        console.error(
          `[Brain] ${def.routine!.name} falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );
  }

  // ── Crossover (Planner Life + My Current Brain) ──────────────

  /** The Brain Office repo (services/ and data/ live there). */
  private officeDir(): string {
    return (
      this.opts.officeRepoDir ?? path.join(path.dirname(this.opts.brainLifeDir), 'brain-agents')
    );
  }

  getHoje(): HojeSnapshot | null {
    return this.hoje;
  }

  async refreshHoje(): Promise<HojeSnapshot> {
    const snap = await readHoje(resolveIntegrationPaths(this.officeDir()));
    // Only announce real changes, so open panels don't re-render every 2 min.
    const key = JSON.stringify({ ...snap, fetchedAt: 0 });
    this.hoje = snap;
    if (key !== this.hojeKey) {
      this.hojeKey = key;
      this.emit({ type: 'hoje' });
    }
    return snap;
  }

  clearBoard(): void {
    this.persistence.clearBoard();
    this.emit({ type: 'boardCleared' });
  }

  removeBoardPost(id: string): boolean {
    const removed = this.persistence.removeBoardPosts(new Set([id])) > 0;
    if (removed) this.emit({ type: 'boardRemoved', id });
    return removed;
  }

  getChat(key: string, limit?: number): ChatEntry[] {
    return this.persistence.readChat(key, limit);
  }

  getPermissions(): PermissionRequestView[] {
    return [...this.permissions.values()].map((p) => p.view);
  }

  getSettings(): BrainSettings {
    return this.state.settings;
  }

  getUsage(): { usage: UsageSnapshot | null; guard: GuardState } {
    return { usage: this.usage, guard: this.guardState() };
  }

  // ── Mutations from the panel ─────────────────────────────────

  setAutonomy(key: string, autonomy: AgentPersistedState['autonomy']): boolean {
    if (!this.defs.has(key)) return false;
    this.ensureState(key).autonomy = autonomy;
    this.persistence.saveState(this.state);
    this.emit({ type: 'agents' });
    return true;
  }

  /** Empty or unknown alias = back to the global model. */
  setModel(key: string, model: string): boolean {
    if (!this.defs.has(key)) return false;
    this.ensureState(key).model = MODEL_ALIASES.includes(model) ? model : undefined;
    this.persistence.saveState(this.state);
    this.emit({ type: 'agents' });
    return true;
  }

  setEnabled(key: string, enabled: boolean): boolean {
    const def = this.defs.get(key);
    if (!def) return false;
    const st = this.ensureState(key);
    st.enabled = enabled;
    if (enabled) this.ensureResident(def, st);
    else {
      this.stop(key);
      this.removeResident(st);
    }
    this.persistence.saveState(this.state);
    this.emit({ type: 'agents' });
    return true;
  }

  updateSettings(patch: Partial<BrainSettings>): BrainSettings {
    const s = this.state.settings;
    if (typeof patch.agentsEnabled === 'boolean') s.agentsEnabled = patch.agentsEnabled;
    if (
      Number.isInteger(patch.maxConcurrent) &&
      patch.maxConcurrent! >= 1 &&
      patch.maxConcurrent! <= 8
    ) {
      s.maxConcurrent = patch.maxConcurrent!;
    }
    for (const k of ['softGuard', 'hardGuard'] as const) {
      const v = patch[k];
      if (typeof v === 'number' && v >= 10 && v <= 100) s[k] = Math.round(v);
    }
    if (s.softGuard > s.hardGuard) s.softGuard = s.hardGuard;
    if (patch.model !== undefined) {
      s.model = patch.model && MODEL_ALIASES.includes(patch.model) ? patch.model : undefined;
    }
    if (
      typeof patch.routineModel === 'string' &&
      (MODEL_ALIASES.includes(patch.routineModel) || patch.routineModel === ROUTINE_MODEL_OWN)
    ) {
      s.routineModel = patch.routineModel;
    }
    if (typeof patch.paceGuard === 'boolean') s.paceGuard = patch.paceGuard;
    if (patch.routineDailyCostCap !== undefined) {
      const v = patch.routineDailyCostCap;
      // 0 or null clears the cap.
      s.routineDailyCostCap = typeof v === 'number' && v > 0 && v <= 1000 ? v : undefined;
    }
    if (typeof patch.briefEnabled === 'boolean') s.briefEnabled = patch.briefEnabled;
    if (typeof patch.briefTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.briefTime)) {
      s.briefTime = patch.briefTime;
    }
    if (patch.pushUrl !== undefined) {
      s.pushUrl =
        typeof patch.pushUrl === 'string' && /^https?:\/\/\S+$/.test(patch.pushUrl)
          ? patch.pushUrl
          : undefined;
    }
    this.persistence.saveState(this.state);
    this.emit({ type: 'settings', settings: s });
    this.emit({ type: 'usage', usage: this.usage ?? this.emptyUsage(), guard: this.guardState() });
    this.pump();
    return s;
  }

  /** Abort the running turn and drop anything queued for this agent. */
  stop(key: string): void {
    const q = this.queues.get(key);
    if (q?.length) {
      for (const job of q.splice(0)) job.reject(new Error('cancelado pelo usuário'));
      this.queueChanged();
    }
    this.running.get(key)?.abort.abort();
    this.setStatus(key, this.running.has(key) ? 'trabalhando' : 'ocioso');
  }

  /** Pause every agent and interrupt what is running now. Queued work stays,
   *  held by the pause, so "retomar" picks it up. */
  stopAll(): void {
    if (this.state.settings.agentsEnabled) this.updateSettings({ agentsEnabled: false });
    for (const r of this.running.values()) r.abort.abort();
  }

  // ── Queue ────────────────────────────────────────────────────

  getQueue(): QueueItemView[] {
    const guard = this.guardState();
    const slotsFull = this.busySlots() >= this.state.settings.maxConcurrent;
    const out: QueueItemView[] = [];
    for (const [agent, q] of this.queues) {
      q.forEach((job, i) => {
        const o = job.origin;
        out.push({
          id: job.id,
          agent,
          origin: o.kind,
          ...(o.kind === 'peer'
            ? { detail: o.from }
            : o.kind === 'rotina'
              ? { detail: o.name }
              : {}),
          preview: job.text.slice(0, PREVIEW_CHARS),
          queuedAt: job.queuedAt,
          reason:
            i > 0 || this.running.has(agent)
              ? 'agente_ocupado'
              : !this.allowed(o)
                ? (guard ?? 'vagas')
                : slotsFull
                  ? 'vagas'
                  : 'iniciando',
        });
      });
    }
    return out.sort((a, b) => a.queuedAt - b.queuedAt);
  }

  cancelQueued(id: string): boolean {
    for (const q of this.queues.values()) {
      const i = q.findIndex((j) => j.id === id);
      if (i === -1) continue;
      const [job] = q.splice(i, 1);
      job.reject(new Error('cancelado pelo usuário'));
      this.queueChanged();
      return true;
    }
    return false;
  }

  /** User messages survive a restart; peer calls can't (the caller's run is
   *  gone) and routines simply come around again. */
  private queueChanged(): void {
    const items: PersistedQueueItem[] = [];
    for (const [agent, q] of this.queues) {
      for (const job of q) {
        if (job.origin.kind !== 'user') continue;
        items.push({
          id: job.id,
          agent,
          text: job.text,
          ...(job.origin.force ? { force: true } : {}),
          queuedAt: job.queuedAt,
        });
      }
    }
    this.persistence.saveQueue(items);
    this.emit({ type: 'queue' });
  }

  private restoreQueue(): void {
    const items = this.persistence.loadQueue();
    if (items.length === 0) return;
    for (const item of items) {
      const def = this.defs.get(item.agent);
      if (!def || !this.isResident(def)) continue;
      if (Date.now() - item.queuedAt > QUEUE_RESTORE_MAX_AGE_MS) {
        this.chat(
          item.agent,
          'system',
          `Mensagem descartada da fila (mais de 24 h esperando): ${item.text.slice(0, PREVIEW_CHARS)}`,
        );
        continue;
      }
      this.chat(item.agent, 'system', 'Mensagem restaurada da fila após reinício do escritório.');
      this.enqueue(
        item.agent,
        { kind: 'user', force: item.force },
        item.text,
        item.id,
        item.queuedAt,
      ).catch(() => {});
    }
    this.queueChanged();
  }

  /** `remember`: also create the request's suggested "sempre permitir" rule. */
  resolvePermission(id: string, allowed: boolean, message?: string, remember = false): boolean {
    const p = this.permissions.get(id);
    if (!p) return false;
    if (allowed && remember && p.view.suggestedRule) {
      this.addRule(p.view.agent, p.view.suggestedRule);
    }
    p.resolve(
      allowed
        ? { behavior: 'allow', updatedInput: p.view.input }
        : { behavior: 'deny', message: message || 'O usuário negou esta ação pelo painel.' },
    );
    return true;
  }

  private addRule(key: string, shape: Omit<AllowRule, 'id' | 'createdAt'>): void {
    const st = this.ensureState(key);
    const rules = st.allowRules ?? [];
    if (rules.some((r) => r.tool === shape.tool && r.pattern === shape.pattern)) return;
    const rule: AllowRule = { id: randomUUID().slice(0, 8), createdAt: Date.now(), ...shape };
    st.allowRules = [...rules, rule];
    this.persistence.saveState(this.state);
    this.chat(key, 'system', `Nova regra: sempre permitir "${describeRule(rule)}".`);
    this.emit({ type: 'agents' });
  }

  removeRule(key: string, ruleId: string): boolean {
    const st = this.state.agents[key];
    const rules = st?.allowRules ?? [];
    if (!st || !rules.some((r) => r.id === ruleId)) return false;
    st.allowRules = rules.filter((r) => r.id !== ruleId);
    this.persistence.saveState(this.state);
    this.emit({ type: 'agents' });
    return true;
  }

  // ── Messaging ────────────────────────────────────────────────

  /** Queue a message for an agent; resolves with its final reply. */
  send(key: string, text: string, origin: RunOrigin): Promise<string> {
    const def = this.defs.get(key);
    if (!def) return Promise.reject(new Error(`agente desconhecido: ${key}`));
    if (!this.isResident(def)) return Promise.reject(new Error(`${def.label} não está ativo`));
    const trimmed = text.trim();
    if (!trimmed) return Promise.reject(new Error('mensagem vazia'));

    if (origin.kind === 'user') this.chat(key, 'user', trimmed);
    else if (origin.kind === 'peer') this.chat(key, 'peer_in', trimmed, origin.from);
    else this.chat(key, 'system', `Rotina: ${origin.name}`);

    return this.enqueue(key, origin, trimmed);
  }

  private enqueue(
    key: string,
    origin: RunOrigin,
    text: string,
    id: string = randomUUID(),
    queuedAt = Date.now(),
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const q = this.queues.get(key) ?? [];
      q.push({ id, text, origin, queuedAt, resolve, reject });
      this.queues.set(key, q);
      this.setStatus(key, this.statuses.get(key)?.status ?? 'ocioso');
      this.queueChanged();
      this.pump();
    });
  }

  runBrief(origin: RunOrigin = { kind: 'user' }): Promise<string> {
    const prompt = [
      'Monte o brief de hoje para o usuário.',
      '1. Chame mcp__escritorio__ler_dados_da_vida uma vez: ela lê direto os bancos do Planner Life e do Current Brain (tarefas, projetos, clientes, faculdade, hábitos, inbox, pesquisa) e funciona mesmo com o Planner Core desligado. Só use as ferramentas do Planner Life para a agenda do Google, e se elas falharem siga sem agenda, avisando no brief numa linha.',
      '2. Use mcp__escritorio__listar_agentes e, só quando fizer diferença, mcp__escritorio__perguntar_agente para consultar até 3 setores com algo relevante. Seja econômico: cada consulta gasta limite de uso.',
      '3. Salve com mcp__escritorio__salvar_brief (título com a data) em markdown: Hoje, Prazos da semana, Clientes, Faculdade, Projetos, O que precisa de você.',
      '4. Responda com um resumo de 5 linhas.',
    ].join('\n');
    return this.send(BRIEF_AGENT, prompt, origin);
  }

  // ── Governor ─────────────────────────────────────────────────

  private maxUtilization(): number {
    const u = this.usage;
    if (!u) return 0;
    return Math.max(u.fiveHour?.utilization ?? 0, u.sevenDay?.utilization ?? 0);
  }

  /** The plan's usage is known and recent. A plan without rate limits (an API
   *  key) reads as known: there is nothing to brake for. */
  private usageKnown(): boolean {
    const u = this.usage;
    if (!u || u.fetchedAt === 0 || Date.now() - u.fetchedAt > USAGE_STALE_MS) return false;
    if (!u.available) return true;
    return typeof (u.fiveHour?.utilization ?? u.sevenDay?.utilization) === 'number';
  }

  guardState(): GuardState {
    const s = this.state.settings;
    if (!s.agentsEnabled) return 'pausado';
    // Unknown usage must not read as 0%: that would let everything through
    // exactly when the governor can't see.
    if (!this.usageKnown()) return 'uso_desconhecido';
    const u = this.maxUtilization();
    if (u >= s.hardGuard) return 'limite_rigido';
    if (u >= s.softGuard) return 'limite_suave';
    if (s.paceGuard && (this.usage?.pace?.projected ?? 0) > 100) return 'ritmo_alto';
    return null;
  }

  private allowed(origin: RunOrigin): boolean {
    const g = this.guardState();
    const forced = origin.kind === 'user' && !!origin.force;
    if (g === 'pausado' || g === 'limite_rigido') return forced;
    if (g !== null) return origin.kind === 'user';
    return true;
  }

  /** Slots in use. An agent waiting on another agent's answer frees its slot,
   *  or with maxConcurrent=1 the one it asked could never start. */
  private busySlots(): number {
    let n = 0;
    for (const key of this.running.keys()) if (!this.awaitingPeer.has(key)) n++;
    return n;
  }

  private pump(): void {
    for (const [key, q] of this.queues) {
      if (this.busySlots() >= this.state.settings.maxConcurrent) return;
      if (this.running.has(key) || q.length === 0) continue;
      if (!this.allowed(q[0].origin)) continue;
      const job = q.shift()!;
      this.queueChanged();
      void this.execute(key, job);
    }
  }

  // ── Runs ─────────────────────────────────────────────────────

  private async execute(key: string, job: Job): Promise<void> {
    const def = this.defs.get(key)!;
    const st = this.ensureState(key);
    const abort = new AbortController();
    this.running.set(key, { abort, origin: job.origin });
    this.setStatus(key, 'trabalhando', 'Pensando');
    this.officeBroadcast({ type: 'agentStatus', id: st.residentId, status: 'active' });

    let loaded: LoadedSdk;
    try {
      loaded = await loadAgentSdk();
    } catch (err) {
      this.finish(key, job, null, `Não foi possível carregar o Claude Agent SDK: ${String(err)}`);
      return;
    }

    // A transcript deleted on disk cannot be resumed: start a fresh session.
    if (st.started && st.sessionId && !fs.existsSync(transcriptPath(def.cwd, st.sessionId))) {
      st.started = false;
      st.sessionId = undefined;
    }
    if (!st.sessionId) st.sessionId = randomUUID();
    this.persistence.saveState(this.state);
    this.bindSession(def, st, false);

    const depth = job.origin.kind === 'peer' ? job.origin.depth : 0;
    const prompt =
      job.origin.kind === 'peer'
        ? `[Mensagem do agente ${this.labelOf(job.origin.from)} (${job.origin.from}), via escritório]\n${job.text}\n\nResponda de forma objetiva: sua resposta final é entregue a ele e aparece no mural para o usuário.`
        : job.text;

    const isRoutine = job.origin.kind === 'rotina';
    const run: RunTrack = {
      gotInit: false,
      ...(isRoutine ? { ephemeralSession: randomUUID() } : {}),
    };
    let reply = '';
    let error: string | null = null;
    for (let attempt = 0; ; attempt++) {
      const resuming = !!st.started && !run.ephemeralSession;
      try {
        reply = await this.runQuery(loaded, key, def, st, job, prompt, depth, abort, run);
        error = null;
      } catch (err) {
        error = abort.signal.aborted
          ? 'Interrompido pelo usuário.'
          : err instanceof Error
            ? err.message
            : String(err);
      }
      // Failing before the session initialized while resuming means the saved
      // session can't be loaded (truncated or corrupted transcript): every run
      // would fail the same way, so start over once with a fresh session.
      if (!error || attempt > 0 || !resuming || run.gotInit || abort.signal.aborted) break;
      this.chat(
        key,
        'system',
        `Não consegui retomar a sessão anterior (${error}). Começando uma sessão nova.`,
      );
      st.started = false;
      st.sessionId = randomUUID();
      this.persistence.saveState(this.state);
      this.bindSession(def, st, false);
    }
    this.recordRun(key, job, run.stats, !error);
    this.finish(key, job, error ? null : reply, error);
  }

  private async runQuery(
    loaded: LoadedSdk,
    key: string,
    def: BrainAgentDef,
    st: AgentPersistedState,
    job: Job,
    prompt: string,
    depth: number,
    abort: AbortController,
    run: RunTrack,
  ): Promise<string> {
    let reply = '';
    const q = loaded.sdk.query({
      prompt,
      options: {
        cwd: def.cwd,
        ...(run.ephemeralSession
          ? { sessionId: run.ephemeralSession }
          : st.started
            ? { resume: st.sessionId }
            : { sessionId: st.sessionId }),
        permissionMode:
          st.autonomy === 'autonomo' ? 'auto' : def.approveEveryChange ? 'default' : 'acceptEdits',
        canUseTool: this.makeCanUseTool(key, st.residentId),
        // Routine runs are unattended, so they get no way to change anything.
        disallowedTools:
          job.origin.kind === 'rotina' && def.routine
            ? ['AskUserQuestion', ...ROUTINE_BLOCKED_TOOLS]
            : ['AskUserQuestion'],
        mcpServers: { escritorio: this.officeServer(loaded, key, depth) },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: this.rolePrompt(def) },
        settingSources: ['user', 'project', 'local'],
        abortController: abort,
        ...this.modelFor(def, st, job.origin),
      },
    });
    for await (const m of q) {
      const text = this.handleMessage(key, def, st, m, run);
      if (text !== null) reply = text;
    }
    return reply;
  }

  /** Routine cycles use the routine model (haiku by default: they only read
   *  and report); everything else the agent's own model, then the global one.
   *  Empty = Claude Code's default. */
  private modelFor(
    def: BrainAgentDef,
    st: AgentPersistedState,
    origin: RunOrigin,
  ): { model?: string } {
    const s = this.state.settings;
    const routineModel =
      origin.kind === 'rotina' && def.routine && s.routineModel !== ROUTINE_MODEL_OWN
        ? s.routineModel
        : undefined;
    const model = routineModel ?? st.model ?? s.model;
    return model ? { model } : {};
  }

  /** Returns the final reply when `m` is the run's result, else null. */
  private handleMessage(
    key: string,
    def: BrainAgentDef,
    st: AgentPersistedState,
    m: SDKMessage,
    run: RunTrack,
  ): string | null {
    switch (m.type) {
      case 'system':
        if ('subtype' in m && m.subtype === 'init') {
          run.gotInit = true;
          if (!st.started && !run.ephemeralSession) {
            st.started = true;
            this.persistence.saveState(this.state);
          }
          const agent = this.opts.store.get(st.residentId);
          const session = run.ephemeralSession ?? st.sessionId!;
          if (agent) this.watchTranscript(agent, transcriptPath(def.cwd, session), false);
        }
        return null;
      case 'assistant': {
        if (m.parent_tool_use_id) return null;
        for (const block of m.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            this.chat(key, 'agent', block.text.trim());
          } else if (block.type === 'tool_use') {
            const status = claudeProvider.formatToolStatus(block.name, block.input);
            this.chat(key, 'tool', status);
            this.setStatus(key, 'trabalhando', status);
          }
        }
        return null;
      }
      case 'rate_limit_event':
        this.scheduleUsageRefresh();
        return null;
      case 'result':
        run.stats = resultStats(m);
        if (m.subtype === 'success') return m.result;
        throw new Error(`execução terminou com ${m.subtype}`);
      default:
        return null;
    }
  }

  private recordRun(key: string, job: Job, stats: RunTrack['stats'], ok: boolean): void {
    // No result message (SDK failed to load, aborted early): nothing was spent
    // that the SDK reported, so there is nothing to record.
    if (!stats) return;
    const record: RunRecord = {
      ts: Date.now(),
      agent: key,
      origin: job.origin.kind,
      ...(job.origin.kind === 'rotina' ? { routine: job.origin.name } : {}),
      ok,
      ...stats,
    };
    const weekAgo = Date.now() - WEEK_MS;
    this.runs = this.runs.filter((r) => r.ts >= weekAgo);
    this.runs.push(record);
    this.persistence.appendRun(record);
    this.emit({ type: 'run', record });
  }

  /** Spend per agent today and over the last 7 days, most expensive first. */
  getConsumption(): Consumption {
    const sum = (since: number): ConsumptionRow[] => {
      const rows = new Map<string, ConsumptionRow>();
      for (const r of this.runs) {
        if (r.ts < since) continue;
        const row = rows.get(r.agent) ?? {
          agent: r.agent,
          runs: 0,
          costUsd: 0,
          tokens: 0,
          routineCostUsd: 0,
        };
        row.runs++;
        row.costUsd += r.costUsd;
        row.tokens += r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheCreationTokens;
        if (r.origin === 'rotina') row.routineCostUsd += r.costUsd;
        rows.set(r.agent, row);
      }
      return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd);
    };
    return { today: sum(startOfToday()), week: sum(Date.now() - WEEK_MS) };
  }

  private routineSpentToday(key: string): number {
    const since = startOfToday();
    return this.runs
      .filter((r) => r.agent === key && r.origin === 'rotina' && r.ts >= since)
      .reduce((s, r) => s + r.costUsd, 0);
  }

  private finish(key: string, job: Job, reply: string | null, error: string | null): void {
    const st = this.ensureState(key);
    this.running.delete(key);
    if (error) {
      this.chat(key, 'error', error);
      job.reject(new Error(error));
    } else {
      job.resolve(reply ?? '');
    }
    this.setStatus(key, 'ocioso');
    // The agent reports back: waiting sends its character to the Diretoria.
    if (job.origin.kind !== 'peer') {
      this.officeBroadcast({ type: 'agentStatus', id: st.residentId, status: 'waiting' });
    }
    this.pump();
  }

  private makeCanUseTool(key: string, residentId: number): CanUseTool {
    return async (toolName, input, { signal }) => {
      if (
        READ_ONLY_TOOLS.has(toolName) ||
        toolName.startsWith('mcp__escritorio__') ||
        READ_ONLY_MCP.test(toolName)
      ) {
        return { behavior: 'allow', updatedInput: input };
      }
      const rule = this.state.agents[key]?.allowRules?.find((r) => ruleMatches(r, toolName, input));
      if (rule) {
        this.chat(key, 'system', `Aprovado pela regra "${describeRule(rule)}".`);
        return { behavior: 'allow', updatedInput: input };
      }
      const suggested = suggestRule(toolName, input);
      const view: PermissionRequestView = {
        id: randomUUID(),
        ts: Date.now(),
        agent: key,
        toolName,
        summary: claudeProvider.formatToolStatus(toolName, input),
        input,
        ...(suggested ? { suggestedRule: suggested } : {}),
      };
      return new Promise<PermissionResult>((resolve) => {
        const done = (result: PermissionResult) => {
          if (!this.permissions.delete(view.id)) return;
          clearTimeout(timeout);
          this.emit({
            type: 'permissionResolved',
            id: view.id,
            allowed: result.behavior === 'allow',
          });
          this.officeBroadcast({ type: 'agentToolPermissionClear', id: residentId });
          this.setStatus(key, 'trabalhando', view.summary);
          resolve(result);
        };
        const timeout = setTimeout(() => {
          const note = `Aprovação expirou sem resposta e a ação foi negada: ${view.summary}`;
          this.chat(key, 'system', note);
          this.board('aviso', key, note, undefined, 'Aprovação expirada');
          done({ behavior: 'deny', message: 'Sem resposta do usuário a tempo.' });
        }, PERMISSION_TIMEOUT_MS);
        signal.addEventListener('abort', () =>
          done({ behavior: 'deny', message: 'Execução interrompida.' }),
        );
        this.permissions.set(view.id, { view, resolve: done });
        this.emit({ type: 'permission', request: view });
        this.officeBroadcast({ type: 'agentToolPermission', id: residentId });
        this.setStatus(key, 'aguardando_aprovacao', view.summary);
      });
    };
  }

  // ── Office tools (in-process MCP server) ─────────────────────

  private officeServer(loaded: LoadedSdk, self: string, depth: number) {
    const { sdk, z } = loaded;
    return sdk.createSdkMcpServer({
      name: 'escritorio',
      version: '1.0.0',
      timeout: PEER_TOOL_TIMEOUT_MS,
      alwaysLoad: true,
      tools: [
        sdk.tool(
          'listar_agentes',
          'Lista os agentes do escritório (os setores da vida do usuário), com descrição e status.',
          {},
          async () => {
            const lines = this.getAgents()
              .filter((a) => a.active && a.key !== self)
              .map(
                (a) =>
                  `- ${a.key} | ${a.label} (${a.kind}) | ${a.status}${a.description ? ` | ${a.description}` : ''}`,
              );
            return textResult(lines.join('\n') || 'Nenhum outro agente ativo.');
          },
        ),
        sdk.tool(
          'perguntar_agente',
          'Envia uma pergunta ou pedido a outro agente do escritório e devolve a resposta dele. A troca aparece no mural para o usuário. Use quando precisar de informação ou ação que pertence a outro setor. Cada consulta gasta limite de uso: seja objetivo.',
          {
            agente: z
              .string()
              .describe(
                'Chave do agente, como aparece em listar_agentes (ex.: setor-agenda, setor-faculdade)',
              ),
            mensagem: z.string().describe('Pergunta ou pedido, com o contexto necessário'),
          },
          async ({ agente, mensagem }) => {
            if (depth >= MAX_PEER_DEPTH) {
              return textResult(
                'Você foi acionado por outro agente e não pode consultar um terceiro. Responda com o que sabe e diga o que falta.',
                true,
              );
            }
            if (agente === self) return textResult('Você não pode perguntar a si mesmo.', true);
            const target = this.defs.get(agente);
            if (!target || !this.isResident(target)) {
              return textResult(
                `Agente "${agente}" não existe ou não está ativo. Use listar_agentes.`,
                true,
              );
            }
            const origin: RunOrigin = { kind: 'peer', from: self, depth: depth + 1 };
            if (!this.allowed(origin)) {
              return textResult(
                'O controle de uso está segurando consultas entre agentes agora. Registre o pedido com publicar_no_mural.',
                true,
              );
            }
            if (this.running.has(agente)) {
              return textResult(
                `${target.label} está ocupado agora. Tente de novo depois ou publique o pedido no mural.`,
                true,
              );
            }
            this.board('pergunta', self, mensagem, agente);
            // Before send(), whose pump() must already see our slot as free.
            this.awaitingPeer.set(self, (this.awaitingPeer.get(self) ?? 0) + 1);
            try {
              const reply = await this.send(agente, mensagem, origin);
              this.board('resposta', agente, reply || '(sem resposta)', self);
              return textResult(reply || '(sem resposta)');
            } catch (err) {
              return textResult(
                `Falha ao consultar ${target.label}: ${err instanceof Error ? err.message : String(err)}`,
                true,
              );
            } finally {
              const n = (this.awaitingPeer.get(self) ?? 1) - 1;
              if (n > 0) this.awaitingPeer.set(self, n);
              else this.awaitingPeer.delete(self);
            }
          },
        ),
        sdk.tool(
          'ler_mural',
          'Lê as publicações recentes do mural (propostas, pedidos, avisos e conversas entre agentes).',
          { limite: z.number().optional() },
          async ({ limite }) => {
            const posts = this.persistence.readBoard(Math.min(Math.max(limite ?? 40, 1), 200));
            const lines = posts.map(
              (p) =>
                `[${new Date(p.ts).toISOString().slice(0, 16)}] ${p.kind} de ${p.from}${p.to ? ` para ${p.to}` : ''}${p.title ? ` — ${p.title}` : ''}: ${p.text.slice(0, 600)}`,
            );
            return textResult(lines.join('\n') || 'Mural vazio.');
          },
        ),
        sdk.tool(
          'publicar_no_mural',
          'Publica no mural do escritório, que o usuário acompanha pelo painel: necessidades, bloqueios, decisões pendentes ou avisos.',
          {
            titulo: z.string(),
            texto: z.string(),
            tipo: z.enum(['aviso', 'pedido', 'decisao']).optional(),
          },
          async ({ titulo, texto, tipo }) => {
            this.board(tipo ?? 'aviso', self, texto, undefined, titulo);
            return textResult('Publicado no mural.');
          },
        ),
        sdk.tool(
          'agendar_lembrete',
          'Agenda um lembrete que você entrega ao usuário sem gastar limite: na hora, seu personagem vai até a sala dele, o texto aparece e chega uma notificação. Use para hábitos (beber água, pausas), prazos e compromissos. Informe em_minutos OU horario (uma vez) OU a_cada_minutos (repetir, opcionalmente dentro de uma janela diária).',
          {
            texto: z.string().describe('O que dizer ao usuário, curto e direto'),
            em_minutos: z.number().optional(),
            horario: z.string().optional().describe('HH:MM, hoje ou amanhã se já passou'),
            a_cada_minutos: z.number().optional().describe('mínimo 5'),
            janela_inicio: z.string().optional().describe('HH:MM'),
            janela_fim: z.string().optional().describe('HH:MM'),
          },
          async (a) => {
            const r = this.addReminder(self, {
              text: a.texto,
              inMinutes: a.em_minutos,
              at: a.horario,
              everyMinutes: a.a_cada_minutos,
              windowStart: a.janela_inicio,
              windowEnd: a.janela_fim,
            });
            return typeof r === 'string'
              ? textResult(`Lembrete não criado: ${r}`, true)
              : textResult(`Lembrete criado: ${describeReminder(r)}`);
          },
        ),
        sdk.tool(
          'listar_lembretes',
          'Lista os lembretes agendados (os seus e os dos outros agentes).',
          {},
          async () =>
            textResult(
              this.getReminders()
                .map((r) => `${r.agent}: ${describeReminder(r)}`)
                .join('\n') || 'Nenhum lembrete.',
            ),
        ),
        sdk.tool(
          'cancelar_lembrete',
          'Cancela um lembrete pelo id (veja listar_lembretes).',
          { id: z.string() },
          async ({ id }) => {
            const ok = this.removeReminder(id);
            return textResult(ok ? 'Lembrete cancelado.' : 'Lembrete não encontrado.', !ok);
          },
        ),
        sdk.tool(
          'falar_com_usuario',
          'Vai até a sala do usuário e fala com ele agora (aparece no escritório e como notificação). Use para algo que ele precisa saber já, não para respostas normais.',
          { texto: z.string() },
          async ({ texto }) => {
            this.nudge(self, texto);
            return textResult('Mensagem entregue ao usuário.');
          },
        ),
        sdk.tool(
          'ler_dados_da_vida',
          'Lê direto dos bancos locais (sem depender do Planner Core) um retrato da vida do usuário: tarefas pendentes, projetos, clientes, disciplinas, provas e entregas, hábitos, inbox, e o resumo do Current Brain. Use antes das ferramentas do Planner Life para consultas de leitura.',
          { area: z.string().optional() },
          async ({ area }) => {
            try {
              const hoje = await this.refreshHoje();
              const pl = this.local.plannerAll() as Record<string, Array<Record<string, unknown>>>;
              const pending = (rows: Array<Record<string, unknown>>) =>
                rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled');
              const data: Record<string, unknown> = {
                agora: new Date().toISOString(),
                agendaGoogle: hoje.planner.calendarConnected
                  ? hoje.planner.events
                  : 'indisponível (Planner Core ou Google desligado)',
                tarefasPendentes: pending(pl.tasks)
                  .slice(0, 40)
                  .map((t) => ({
                    titulo: t.title,
                    prazo: t.due_at,
                    status: t.status,
                  })),
                projetos: pl.projects.map((p) => ({
                  nome: p.name,
                  progresso: p.progress,
                  objetivo: p.goal,
                })),
                clientes: pl.clients.map((c) => ({
                  nome: c.name,
                  etapa: c.stage,
                  valor: c.value,
                  proximaAcao: c.next_action,
                  quando: c.next_action_at,
                })),
                faculdade: {
                  disciplinas: pl.subjects.map((x) => ({
                    nome: x.name,
                    prova: x.exam_date,
                    progresso: x.progress,
                  })),
                  entregas: pl.topics
                    .filter((t) => !t.done && t.due_at)
                    .slice(0, 20)
                    .map((t) => ({ titulo: t.title, prazo: t.due_at })),
                },
                habitos: pl.habits.map((h) => ({
                  nome: h.name,
                  atual: h.current,
                  meta: h.target,
                  unidade: h.unit,
                })),
                inboxSemTratar: pl.messages.filter((m) => !m.handled).length,
                currentBrain: hoje.brain,
              };
              const keys: Record<string, string[]> = {
                agenda: ['agora', 'agendaGoogle', 'tarefasPendentes'],
                faculdade: ['agora', 'faculdade'],
                clientes: ['agora', 'clientes', 'inboxSemTratar'],
                projetos: ['agora', 'projetos', 'tarefasPendentes'],
                pessoal: ['agora', 'habitos'],
                pesquisa: ['agora', 'currentBrain'],
              };
              const pick = area && keys[area] ? keys[area] : Object.keys(data);
              const out = Object.fromEntries(pick.map((k) => [k, data[k]]));
              return textResult(JSON.stringify(out).slice(0, 24_000));
            } catch (err) {
              return textResult(
                `Falha ao ler os bancos locais: ${err instanceof Error ? err.message : String(err)}`,
                true,
              );
            }
          },
        ),
        sdk.tool(
          'salvar_brief',
          'Salva um brief (relatório em markdown) na aba Briefs do painel do usuário.',
          { titulo: z.string(), markdown: z.string() },
          async ({ titulo, markdown }) => {
            const brief: Brief = {
              id: `${today()}-${randomUUID().slice(0, 8)}`,
              ts: Date.now(),
              from: self,
              title: titulo,
              markdown,
            };
            this.persistence.saveBrief(brief);
            this.emit({
              type: 'brief',
              brief: { id: brief.id, ts: brief.ts, from: self, title: titulo },
            });
            this.board('brief', self, titulo, undefined, titulo);
            return textResult(`Brief salvo (${brief.id}).`);
          },
        ),
      ],
    });
  }

  private rolePrompt(def: BrainAgentDef): string {
    const who = `Você é o agente residente do setor "${def.label}" no Escritório da Vida do usuário. ${def.description}`;
    return [
      who,
      '',
      'Protocolo do escritório:',
      '- O usuário fala com você pelo painel de controle do escritório em pixel art. Responda em português do Brasil, direto e sem emojis.',
      '- Você pode usar subagentes (Task/Agent) para dividir trabalho e pode construir ou alterar arquivos dentro da sua pasta. Para assuntos de outro setor, peça ao agente responsável.',
      '- mcp__escritorio__listar_agentes mostra os outros agentes; mcp__escritorio__perguntar_agente consulta um deles (a conversa aparece no mural para o usuário). Consulte quando a informação for de outro setor, em vez de adivinhar.',
      '- mcp__escritorio__ler_dados_da_vida lê tarefas, projetos, clientes, faculdade, hábitos e o Current Brain direto dos bancos, sem depender do Planner Core: use-a para ler; as ferramentas do Planner Life ficam para escrever e para a agenda do Google.',
      '- mcp__escritorio__publicar_no_mural registra necessidades, bloqueios e decisões para o usuário; mcp__escritorio__salvar_brief salva relatórios.',
      '- mcp__escritorio__agendar_lembrete cria lembretes que você entrega sozinho (hábitos, pausas, prazos) sem gastar limite; mcp__escritorio__falar_com_usuario vai até a sala dele e avisa algo urgente.',
      '- Você roda sem terminal interativo: não use AskUserQuestion. Se precisar de algo do usuário, termine a resposta dizendo exatamente o que precisa.',
      '- O uso da assinatura do usuário é limitado: seja econômico em buscas, subagentes e consultas.',
    ].join('\n');
  }

  // ── Usage ────────────────────────────────────────────────────

  private emptyUsage(): UsageSnapshot {
    return { fetchedAt: 0, subscription: null, available: false, fiveHour: null, sevenDay: null };
  }

  private scheduleUsageRefresh(): void {
    if (this.usageDebounce) return;
    this.usageDebounce = setTimeout(() => {
      this.usageDebounce = null;
      void this.refreshUsage();
    }, USAGE_EVENT_DEBOUNCE_MS);
  }

  /** Plan utilization through the SDK's /usage control request. It is marked
   *  experimental upstream, so every field is read defensively and a failure
   *  only leaves the last snapshot in place. */
  async refreshUsage(): Promise<UsageSnapshot | null> {
    let q: { close(): void } | null = null;
    try {
      const { sdk } = await loadAgentSdk();
      const idle = (async function* () {
        await new Promise<never>(() => {});
      })();
      const query = sdk.query({
        prompt: idle,
        options: { cwd: this.opts.brainLifeDir, settingSources: [] },
      });
      q = query;
      const getUsage = (query as unknown as Record<string, unknown>)[
        'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
      ];
      if (typeof getUsage !== 'function') throw new Error('SDK sem leitura de uso');
      const u = (await getUsage.call(query, { skipBehaviors: true })) as {
        subscription_type?: string | null;
        rate_limits_available?: boolean;
        rate_limits?: Record<
          string,
          { utilization?: number | null; resets_at?: string | null } | null
        > | null;
      };
      const win = (
        w: { utilization?: number | null; resets_at?: string | null } | null | undefined,
      ) =>
        w
          ? {
              utilization: typeof w.utilization === 'number' ? w.utilization : null,
              resetsAt: w.resets_at ?? null,
            }
          : null;
      const sevenDay = win(u.rate_limits?.seven_day);
      const pace = computePace(sevenDay, Date.now());
      this.usage = {
        fetchedAt: Date.now(),
        subscription: u.subscription_type ?? null,
        available: !!u.rate_limits_available,
        fiveHour: win(u.rate_limits?.five_hour),
        sevenDay,
        ...(pace ? { pace } : {}),
      };
    } catch (err) {
      this.usage = {
        ...(this.usage ?? this.emptyUsage()),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      q?.close();
    }
    this.emit({ type: 'usage', usage: this.usage!, guard: this.guardState() });
    this.pump();
    return this.usage;
  }

  // ── Reception (router) ───────────────────────────────────────

  /** Pick the agent a free-form message belongs to with one cheap model call,
   *  then deliver it there. Falls back to the chief of staff on any doubt. */
  async routeMessage(text: string, force = false): Promise<{ agent: string; reason: string }> {
    const candidates = this.getAgents().filter((a) => a.active);
    let agent = candidates.some((a) => a.key === ROUTER_FALLBACK)
      ? ROUTER_FALLBACK
      : candidates[0]?.key;
    let reason = 'encaminhado ao chefe de gabinete';
    if (!agent) throw new Error('nenhum agente ativo');
    try {
      const { sdk } = await loadAgentSdk();
      const list = candidates
        .map((a) => `${a.key}: ${a.label} — ${a.description || a.kind}`)
        .join('\n');
      const prompt = [
        'Você é a recepção de um escritório de agentes pessoais. Escolha o agente mais adequado para a mensagem do usuário.',
        'Cada agente cuida de uma área da vida; perguntas sobre projetos de software vão para setor-projetos. Mensagens gerais, de agenda ou que envolvem várias áreas vão para setor-agenda.',
        '',
        'Agentes:',
        list,
        '',
        `Mensagem: """${text.slice(0, 4000)}"""`,
        '',
        'Responda somente com JSON: {"agente": "<chave>", "motivo": "<até 12 palavras>"}',
      ].join('\n');
      let out = '';
      for await (const m of sdk.query({
        prompt,
        options: {
          cwd: this.opts.brainLifeDir,
          model: 'haiku',
          maxTurns: 1,
          allowedTools: [],
          tools: [],
          settingSources: [],
          systemPrompt: 'Você classifica mensagens. Responda apenas com o JSON pedido.',
        },
      })) {
        if (m.type === 'result' && m.subtype === 'success') out = m.result;
      }
      const match = out.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { agente?: unknown; motivo?: unknown };
        if (typeof parsed.agente === 'string' && candidates.some((a) => a.key === parsed.agente)) {
          agent = parsed.agente;
          reason = typeof parsed.motivo === 'string' ? parsed.motivo : '';
        }
      }
    } catch (err) {
      console.error(
        `[Brain] recepção falhou, usando ${agent}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.chat(
      agent,
      'system',
      `Recepção encaminhou para ${this.labelOf(agent)}${reason ? `: ${reason}` : ''}`,
    );
    this.board('recepcao', 'recepcao', text, agent, reason || undefined);
    this.emit({ type: 'routed', agent, reason });
    this.send(agent, text, { kind: 'user', force }).catch(() => {});
    return { agent, reason };
  }

  // ── Reminders & nudges ───────────────────────────────────────

  getReminders(): Reminder[] {
    return [...this.reminders].sort((a, b) => a.nextAt - b.nextAt);
  }

  addReminder(agent: string, input: ReminderInput): Reminder | string {
    if (!this.defs.has(agent)) return `agente desconhecido: ${agent}`;
    const r = buildReminder(agent, input, randomUUID().slice(0, 8));
    if (typeof r === 'string') return r;
    this.reminders.push(r);
    this.saveReminders();
    return r;
  }

  removeReminder(id: string): boolean {
    const before = this.reminders.length;
    this.reminders = this.reminders.filter((r) => r.id !== id);
    if (this.reminders.length === before) return false;
    this.saveReminders();
    return true;
  }

  setReminderActive(id: string, active: boolean): boolean {
    const r = this.reminders.find((x) => x.id === id);
    if (!r) return false;
    r.active = active;
    if (active && r.nextAt < Date.now())
      r.nextAt = nextAfterFiring(r, Date.now()) ?? Date.now() + 60_000;
    this.saveReminders();
    return true;
  }

  private saveReminders(): void {
    this.persistence.saveReminders(this.reminders);
    this.emit({ type: 'reminders' });
  }

  /** Starter reminders the user asked for (water); created once, deletable. */
  private seedReminders(): void {
    if (this.state.settings.remindersSeeded) return;
    if (this.defs.has('setor-pessoal')) {
      this.addReminder('setor-pessoal', {
        text: 'Hora de beber água. Um copo agora.',
        everyMinutes: 90,
        windowStart: '08:00',
        windowEnd: '22:00',
      });
    }
    this.state.settings.remindersSeeded = true;
    this.persistence.saveState(this.state);
  }

  private fireDueReminders(now: number): void {
    let changed = false;
    for (const r of this.reminders) {
      if (!r.active || r.nextAt > now) continue;
      this.nudge(r.agent, r.text, r.id);
      const next = nextAfterFiring(r, now);
      if (next === null) r.active = false;
      else r.nextAt = next;
      changed = true;
    }
    if (changed) this.saveReminders();
  }

  /** The agent walks to the user's office and says `text`: office bubble,
   *  panel toast + browser notification (via the event), phone push. */
  /** The Planner agent's own notices (morning summary, event in 15 min, Google
   *  Tasks due) had a banner in the Planner web app. Here the Agenda agent walks
   *  them to the user's desk instead, with the same push as any reminder. */
  private async relayPlannerNotices(): Promise<void> {
    const base = `http://127.0.0.1:${process.env['AGENT_PORT'] ?? 4100}`;
    let list: Array<{ id: string; title?: string; body?: string }>;
    try {
      const res = await fetch(`${base}/notifications/pending`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return;
      list = (await res.json()) as typeof list;
    } catch {
      return; // Planner agent off: nothing to relay
    }
    const agent = this.defs.has('setor-agenda') ? 'setor-agenda' : [...this.defs.keys()][0];
    for (const n of Array.isArray(list) ? list : []) {
      if (!n?.id) continue;
      const title = (n.title ?? '').trim();
      const body = (n.body ?? '').trim();
      if (agent && body)
        this.nudge(agent, title && title !== 'Planner Life' ? `${title}: ${body}` : body);
      await fetch(`${base}/notifications/${encodeURIComponent(n.id)}/ack`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      }).catch(() => undefined);
    }
  }

  nudge(agentKey: string, text: string, reminderId?: string): Nudge {
    const st = this.state.agents[agentKey];
    const residentId = st && this.opts.store.has(st.residentId) ? st.residentId : null;
    const n: Nudge = {
      id: randomUUID(),
      ts: Date.now(),
      agent: agentKey,
      residentId,
      text,
      ...(reminderId ? { reminderId } : {}),
    };
    this.chat(agentKey, 'lembrete', text);
    // Reminders repeat all day: they stay in the chat and the office bubble,
    // not on the board, which is for things that need a decision.
    this.emit({ type: 'nudge', nudge: n });
    if (residentId !== null && !this.running.has(agentKey)) {
      this.officeBroadcast({
        type: 'agentStatus',
        id: residentId,
        status: 'waiting',
        awaitingInput: true,
      });
    }
    void this.push(`${this.labelOf(agentKey)}: ${text}`);
    return n;
  }

  private async push(message: string): Promise<void> {
    const url = this.state.settings.pushUrl;
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        body: message,
        headers: { Tags: 'office', Priority: 'default' },
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
    } catch (err) {
      console.error(`[Brain] push falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Scheduler ────────────────────────────────────────────────

  private tickScheduler(): void {
    this.fireDueReminders(Date.now());
    if (Date.now() - this.lastRescan >= REGISTRY_RESCAN_MS) {
      this.lastRescan = Date.now();
      this.refreshRegistry();
    }
    for (const def of this.defs.values()) {
      if (!def.routine || !this.isResident(def)) continue;
      const st = this.ensureState(def.key);
      if (st.routinePaused || st.lastRoutineAt === undefined) continue;
      if (Date.now() - st.lastRoutineAt >= def.routine.everyMinutes * 60_000)
        this.startRoutine(def, st);
    }
    const s = this.state.settings;
    if (!s.briefEnabled || !this.defs.has(BRIEF_AGENT)) return;
    const now = new Date();
    const [h, m] = s.briefTime.split(':').map(Number);
    const late = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
    if (late < 0) return;
    if (s.lastBriefDate === today(now)) return;
    s.lastBriefDate = today(now);
    this.persistence.saveState(this.state);
    // Opening the office hours after the brief time skips today's run
    // instead of spending the plan's usage on a stale morning brief.
    if (late > BRIEF_GRACE_MINUTES) return;
    this.runBrief({ kind: 'rotina', name: 'brief diário' }).catch((err: unknown) => {
      console.error(
        `[Brain] brief diário falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  private labelOf(key: string): string {
    return this.defs.get(key)?.label ?? key;
  }

  private setStatus(key: string, status: AgentRunStatus, activity?: string): void {
    this.statuses.set(key, { status, activity });
    this.emit({
      type: 'status',
      agent: key,
      status,
      activity,
      queued: this.queues.get(key)?.length ?? 0,
    });
  }

  private chat(agent: string, role: ChatRole, text: string, from?: string): void {
    const entry: ChatEntry = {
      id: randomUUID(),
      ts: Date.now(),
      agent,
      role,
      text,
      ...(from ? { from } : {}),
    };
    this.persistence.appendChat(entry);
    this.emit({ type: 'chat', entry });
  }

  private board(kind: BoardKind, from: string, text: string, to?: string, title?: string): void {
    const post: BoardPost = {
      id: randomUUID(),
      ts: Date.now(),
      kind,
      from,
      text,
      ...(to ? { to } : {}),
      ...(title ? { title } : {}),
    };
    this.persistence.appendBoard(post);
    this.emit({ type: 'board', post });
  }
}
