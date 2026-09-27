import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  CanUseTool,
  PermissionResult,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };

import { normalizeProjectPath } from '../../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from '../agentRuntime.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from '../constants.js';
import { startFileWatching } from '../fileWatcher.js';
import { assignPaletteIfNeeded } from '../paletteAssigner.js';
import { claudeProvider } from '../providers/index.js';
import type { AgentState } from '../types.js';
import { BrainPersistence } from './persistence.js';
import { discoverAgents } from './registry.js';
import { buildReminder, describeReminder, nextAfterFiring, type ReminderInput } from './reminders.js';
import { loadAgentSdk, type LoadedSdk } from './sdkLoader.js';
import type {
  AgentPersistedState,
  AgentRunStatus,
  AgentView,
  BoardKind,
  BoardPost,
  BrainAgentDef,
  BrainEvent,
  BrainSettings,
  BrainState,
  Brief,
  ChatEntry,
  ChatRole,
  GuardState,
  Nudge,
  PermissionRequestView,
  Reminder,
  RunOrigin,
  UsageSnapshot,
} from './types.js';

const USAGE_POLL_MS = 5 * 60 * 1000;
const USAGE_EVENT_DEBOUNCE_MS = 30 * 1000;
const SCHEDULER_TICK_MS = 30 * 1000;
/** New, renamed and deleted project folders show up within this interval. */
const REGISTRY_RESCAN_MS = 60 * 1000;
const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;
const TRANSCRIPT_WAIT_MS = 30 * 1000;
/** Agent-to-agent hops allowed. A run started by another agent cannot ask a
 *  third one, so call chains (and cycles) are impossible. */
const MAX_PEER_DEPTH = 1;
const PEER_TOOL_TIMEOUT_MS = 20 * 60 * 1000;
const BRIEF_AGENT = 'setor-agenda';
const BRIEF_GRACE_MINUTES = 120;
const ROUTER_FALLBACK = 'setor-agenda';
const PUSH_TIMEOUT_MS = 10_000;

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
  resolve: (reply: string) => void;
  reject: (err: Error) => void;
}

interface PendingPermission {
  view: PermissionRequestView;
  resolve: (result: PermissionResult) => void;
}

export interface BrainServiceOptions {
  brainLifeDir: string;
  repoRoot: string;
  store: AgentStateStore;
  runtime: AgentRuntime;
  persistence?: BrainPersistence;
}

function transcriptPath(cwd: string, sessionId: string): string {
  return path.join(os.homedir(), '.claude', 'projects', normalizeProjectPath(cwd), `${sessionId}.jsonl`);
}

function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

export class BrainService {
  readonly persistence: BrainPersistence;
  private readonly events = new EventEmitter();
  private defs = new Map<string, BrainAgentDef>();
  private state: BrainState;
  private readonly queues = new Map<string, Job[]>();
  private readonly running = new Map<string, { abort: AbortController; origin: RunOrigin }>();
  private readonly statuses = new Map<string, { status: AgentRunStatus; activity?: string }>();
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly watchedTranscripts = new Set<string>();
  private usage: UsageSnapshot | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private usageDebounce: ReturnType<typeof setTimeout> | null = null;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private reminders: Reminder[];
  private lastRescan = Date.now();

  constructor(private readonly opts: BrainServiceOptions) {
    this.persistence = opts.persistence ?? new BrainPersistence();
    this.state = this.persistence.loadState();
    this.reminders = this.persistence.loadReminders();
    this.events.setMaxListeners(100);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  start(): void {
    this.refreshRegistry();
    this.seedReminders();
    void this.refreshUsage();
    this.usageTimer = setInterval(() => void this.refreshUsage(), USAGE_POLL_MS);
    this.schedulerTimer = setInterval(() => this.tickScheduler(), SCHEDULER_TICK_MS);
    const residents = [...this.defs.values()].filter((d) => this.isResident(d)).length;
    console.log(`[Brain] ${residents} agentes residentes (${this.defs.size} descobertos)`);
  }

  dispose(): void {
    if (this.usageTimer) clearInterval(this.usageTimer);
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
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

  /** Re-scan sectors and projects; create or remove resident characters. */
  refreshRegistry(): void {
    const defs = discoverAgents(this.opts.brainLifeDir, this.opts.repoRoot);
    const before = [...this.defs.keys()].sort().join('|');
    this.defs = new Map(defs.map((d) => [d.key, d]));
    for (const def of defs) {
      const st = this.ensureState(def.key);
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
    const projectDir = path.join(os.homedir(), '.claude', 'projects', normalizeProjectPath(def.cwd));
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
        status: s?.status ?? 'ocioso',
        activity: s?.activity,
        queued: this.queues.get(def.key)?.length ?? 0,
        started: !!st.started,
      };
    });
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
    if (Number.isInteger(patch.maxConcurrent) && patch.maxConcurrent! >= 1 && patch.maxConcurrent! <= 8) {
      s.maxConcurrent = patch.maxConcurrent!;
    }
    for (const k of ['softGuard', 'hardGuard'] as const) {
      const v = patch[k];
      if (typeof v === 'number' && v >= 10 && v <= 100) s[k] = Math.round(v);
    }
    if (s.softGuard > s.hardGuard) s.softGuard = s.hardGuard;
    if (patch.model !== undefined) {
      s.model = patch.model && ['sonnet', 'opus', 'haiku'].includes(patch.model) ? patch.model : undefined;
    }
    if (typeof patch.briefEnabled === 'boolean') s.briefEnabled = patch.briefEnabled;
    if (typeof patch.briefTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.briefTime)) {
      s.briefTime = patch.briefTime;
    }
    if (patch.pushUrl !== undefined) {
      s.pushUrl = typeof patch.pushUrl === 'string' && /^https?:\/\/\S+$/.test(patch.pushUrl) ? patch.pushUrl : undefined;
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
    if (q) {
      for (const job of q.splice(0)) job.reject(new Error('cancelado pelo usuário'));
    }
    this.running.get(key)?.abort.abort();
    this.setStatus(key, this.running.has(key) ? 'trabalhando' : 'ocioso');
  }

  resolvePermission(id: string, allowed: boolean, message?: string): boolean {
    const p = this.permissions.get(id);
    if (!p) return false;
    p.resolve(
      allowed
        ? { behavior: 'allow', updatedInput: p.view.input }
        : { behavior: 'deny', message: message || 'O usuário negou esta ação pelo painel.' },
    );
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

    return new Promise<string>((resolve, reject) => {
      const q = this.queues.get(key) ?? [];
      q.push({ id: randomUUID(), text: trimmed, origin, resolve, reject });
      this.queues.set(key, q);
      this.setStatus(key, this.statuses.get(key)?.status ?? 'ocioso');
      this.pump();
    });
  }

  runBrief(origin: RunOrigin = { kind: 'user' }): Promise<string> {
    const prompt = [
      'Monte o brief de hoje para o usuário.',
      '1. Use as ferramentas do Planner Life para agenda de hoje e amanhã, tarefas vencidas ou do dia, provas e entregas da semana, próximas ações de clientes e hábitos.',
      '2. Use mcp__escritorio__listar_agentes e, só quando fizer diferença, mcp__escritorio__perguntar_agente para consultar até 3 agentes de projetos ou setores com algo relevante. Seja econômico: cada consulta gasta limite de uso.',
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

  guardState(): GuardState {
    const s = this.state.settings;
    if (!s.agentsEnabled) return 'pausado';
    const u = this.maxUtilization();
    if (u >= s.hardGuard) return 'limite_rigido';
    if (u >= s.softGuard) return 'limite_suave';
    return null;
  }

  private allowed(origin: RunOrigin): boolean {
    const g = this.guardState();
    const forced = origin.kind === 'user' && !!origin.force;
    if (g === 'pausado' || g === 'limite_rigido') return forced;
    if (g === 'limite_suave') return origin.kind === 'user';
    return true;
  }

  private pump(): void {
    for (const [key, q] of this.queues) {
      if (this.running.size >= this.state.settings.maxConcurrent) return;
      if (this.running.has(key) || q.length === 0) continue;
      if (!this.allowed(q[0].origin)) continue;
      const job = q.shift()!;
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

    let reply = '';
    let error: string | null = null;
    try {
      const q = loaded.sdk.query({
        prompt,
        options: {
          cwd: def.cwd,
          ...(st.started ? { resume: st.sessionId } : { sessionId: st.sessionId }),
          permissionMode: st.autonomy === 'autonomo' ? 'auto' : 'acceptEdits',
          canUseTool: this.makeCanUseTool(key, st.residentId),
          disallowedTools: ['AskUserQuestion'],
          mcpServers: { escritorio: this.officeServer(loaded, key, depth) },
          systemPrompt: { type: 'preset', preset: 'claude_code', append: this.rolePrompt(def) },
          settingSources: ['user', 'project', 'local'],
          abortController: abort,
          ...(this.state.settings.model ? { model: this.state.settings.model } : {}),
        },
      });
      for await (const m of q) {
        const text = this.handleMessage(key, def, st, m);
        if (text !== null) reply = text;
      }
    } catch (err) {
      error = abort.signal.aborted ? 'Interrompido pelo usuário.' : err instanceof Error ? err.message : String(err);
    }
    this.finish(key, job, error ? null : reply, error);
  }

  /** Returns the final reply when `m` is the run's result, else null. */
  private handleMessage(key: string, def: BrainAgentDef, st: AgentPersistedState, m: SDKMessage): string | null {
    switch (m.type) {
      case 'system':
        if ('subtype' in m && m.subtype === 'init') {
          if (!st.started) {
            st.started = true;
            this.persistence.saveState(this.state);
          }
          const agent = this.opts.store.get(st.residentId);
          if (agent) this.watchTranscript(agent, transcriptPath(def.cwd, st.sessionId!), false);
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
        if (m.subtype === 'success') return m.result;
        throw new Error(`execução terminou com ${m.subtype}`);
      default:
        return null;
    }
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
      if (READ_ONLY_TOOLS.has(toolName) || toolName.startsWith('mcp__escritorio__') || READ_ONLY_MCP.test(toolName)) {
        return { behavior: 'allow', updatedInput: input };
      }
      const view: PermissionRequestView = {
        id: randomUUID(),
        ts: Date.now(),
        agent: key,
        toolName,
        summary: claudeProvider.formatToolStatus(toolName, input),
        input,
      };
      return new Promise<PermissionResult>((resolve) => {
        const done = (result: PermissionResult) => {
          if (!this.permissions.delete(view.id)) return;
          clearTimeout(timeout);
          this.emit({ type: 'permissionResolved', id: view.id, allowed: result.behavior === 'allow' });
          this.officeBroadcast({ type: 'agentToolPermissionClear', id: residentId });
          this.setStatus(key, 'trabalhando', view.summary);
          resolve(result);
        };
        const timeout = setTimeout(
          () => done({ behavior: 'deny', message: 'Sem resposta do usuário a tempo.' }),
          PERMISSION_TIMEOUT_MS,
        );
        signal.addEventListener('abort', () => done({ behavior: 'deny', message: 'Execução interrompida.' }));
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
          'Lista os agentes do escritório (setores da vida do usuário e um agente por projeto ativo), com descrição e status.',
          {},
          async () => {
            const lines = this.getAgents()
              .filter((a) => a.active && a.key !== self)
              .map((a) => `- ${a.key} | ${a.label} (${a.kind}) | ${a.status}${a.description ? ` | ${a.description}` : ''}`);
            return textResult(lines.join('\n') || 'Nenhum outro agente ativo.');
          },
        ),
        sdk.tool(
          'perguntar_agente',
          'Envia uma pergunta ou pedido a outro agente do escritório e devolve a resposta dele. A troca aparece no mural para o usuário. Use quando precisar de informação ou ação que pertence a outro projeto ou setor. Cada consulta gasta limite de uso: seja objetivo.',
          {
            agente: z.string().describe('Chave do agente, como aparece em listar_agentes (ex.: setor-agenda, projeto-currentBrain)'),
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
              return textResult(`Agente "${agente}" não existe ou não está ativo. Use listar_agentes.`, true);
            }
            const origin: RunOrigin = { kind: 'peer', from: self, depth: depth + 1 };
            if (!this.allowed(origin)) {
              return textResult('O controle de uso está segurando consultas entre agentes agora. Registre o pedido com publicar_no_mural.', true);
            }
            if (this.running.has(agente)) {
              return textResult(`${target.label} está ocupado agora. Tente de novo depois ou publique o pedido no mural.`, true);
            }
            this.board('pergunta', self, mensagem, agente);
            try {
              const reply = await this.send(agente, mensagem, origin);
              this.board('resposta', agente, reply || '(sem resposta)', self);
              return textResult(reply || '(sem resposta)');
            } catch (err) {
              return textResult(`Falha ao consultar ${target.label}: ${err instanceof Error ? err.message : String(err)}`, true);
            }
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
            return typeof r === 'string' ? textResult(`Lembrete não criado: ${r}`, true) : textResult(`Lembrete criado: ${describeReminder(r)}`);
          },
        ),
        sdk.tool(
          'listar_lembretes',
          'Lista os lembretes agendados (os seus e os dos outros agentes).',
          {},
          async () => textResult(this.getReminders().map((r) => `${r.agent}: ${describeReminder(r)}`).join('\n') || 'Nenhum lembrete.'),
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
          'salvar_brief',
          'Salva um brief (relatório em markdown) na aba Briefs do painel do usuário.',
          { titulo: z.string(), markdown: z.string() },
          async ({ titulo, markdown }) => {
            const brief: Brief = { id: `${today()}-${randomUUID().slice(0, 8)}`, ts: Date.now(), from: self, title: titulo, markdown };
            this.persistence.saveBrief(brief);
            this.emit({ type: 'brief', brief: { id: brief.id, ts: brief.ts, from: self, title: titulo } });
            this.board('brief', self, titulo, undefined, titulo);
            return textResult(`Brief salvo (${brief.id}).`);
          },
        ),
      ],
    });
  }

  private rolePrompt(def: BrainAgentDef): string {
    const who =
      def.kind === 'setor'
        ? `Você é o agente residente do setor "${def.label}" no Escritório da Vida do usuário. ${def.description}`
        : `Você é o agente responsável pelo projeto "${def.label}" (${def.cwd}) no Escritório da Vida do usuário.${def.description ? ` Sobre o projeto: ${def.description}` : ''} Antes de responder sobre o projeto, confira o código, o README, o CLAUDE.md e o git log em vez de supor.`;
    return [
      who,
      '',
      'Protocolo do escritório:',
      '- O usuário fala com você pelo painel de controle do escritório em pixel art. Responda em português do Brasil, direto e sem emojis.',
      '- Você pode usar subagentes (Task/Agent) para dividir trabalho e pode construir ou alterar arquivos dentro da sua pasta. Para mexer em outro projeto ou setor, peça ao agente responsável.',
      '- mcp__escritorio__listar_agentes mostra os outros agentes; mcp__escritorio__perguntar_agente consulta um deles (a conversa aparece no mural para o usuário). Consulte quando a informação for de outro projeto ou setor, em vez de adivinhar.',
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
      const query = sdk.query({ prompt: idle, options: { cwd: this.opts.brainLifeDir, settingSources: [] } });
      q = query;
      const getUsage = (query as unknown as Record<string, unknown>)[
        'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET'
      ];
      if (typeof getUsage !== 'function') throw new Error('SDK sem leitura de uso');
      const u = (await getUsage.call(query, { skipBehaviors: true })) as {
        subscription_type?: string | null;
        rate_limits_available?: boolean;
        rate_limits?: Record<string, { utilization?: number | null; resets_at?: string | null } | null> | null;
      };
      const win = (w: { utilization?: number | null; resets_at?: string | null } | null | undefined) =>
        w ? { utilization: typeof w.utilization === 'number' ? w.utilization : null, resetsAt: w.resets_at ?? null } : null;
      this.usage = {
        fetchedAt: Date.now(),
        subscription: u.subscription_type ?? null,
        available: !!u.rate_limits_available,
        fiveHour: win(u.rate_limits?.five_hour),
        sevenDay: win(u.rate_limits?.seven_day),
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
    let agent = candidates.some((a) => a.key === ROUTER_FALLBACK) ? ROUTER_FALLBACK : candidates[0]?.key;
    let reason = 'encaminhado ao chefe de gabinete';
    if (!agent) throw new Error('nenhum agente ativo');
    try {
      const { sdk } = await loadAgentSdk();
      const list = candidates.map((a) => `${a.key}: ${a.label} — ${a.description || a.kind}`).join('\n');
      const prompt = [
        'Você é a recepção de um escritório de agentes pessoais. Escolha o agente mais adequado para a mensagem do usuário.',
        'Setores cuidam de áreas da vida; agentes "projeto-*" cuidam de um repositório específico. Mensagens gerais, de agenda ou que envolvem várias áreas vão para setor-agenda.',
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
      console.error(`[Brain] recepção falhou, usando ${agent}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.chat(agent, 'system', `Recepção encaminhou para ${this.labelOf(agent)}${reason ? `: ${reason}` : ''}`);
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
    if (active && r.nextAt < Date.now()) r.nextAt = nextAfterFiring(r, Date.now()) ?? Date.now() + 60_000;
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
  nudge(agentKey: string, text: string, reminderId?: string): Nudge {
    const st = this.state.agents[agentKey];
    const residentId = st && this.opts.store.has(st.residentId) ? st.residentId : null;
    const n: Nudge = { id: randomUUID(), ts: Date.now(), agent: agentKey, residentId, text, ...(reminderId ? { reminderId } : {}) };
    this.chat(agentKey, 'lembrete', text);
    this.board('lembrete', agentKey, text);
    this.emit({ type: 'nudge', nudge: n });
    if (residentId !== null && !this.running.has(agentKey)) {
      this.officeBroadcast({ type: 'agentStatus', id: residentId, status: 'waiting', awaitingInput: true });
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
      console.error(`[Brain] brief diário falhou: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  private labelOf(key: string): string {
    return this.defs.get(key)?.label ?? key;
  }

  private setStatus(key: string, status: AgentRunStatus, activity?: string): void {
    this.statuses.set(key, { status, activity });
    this.emit({ type: 'status', agent: key, status, activity, queued: this.queues.get(key)?.length ?? 0 });
  }

  private chat(agent: string, role: ChatRole, text: string, from?: string): void {
    const entry: ChatEntry = { id: randomUUID(), ts: Date.now(), agent, role, text, ...(from ? { from } : {}) };
    this.persistence.appendChat(entry);
    this.emit({ type: 'chat', entry });
  }

  private board(kind: BoardKind, from: string, text: string, to?: string, title?: string): void {
    const post: BoardPost = { id: randomUUID(), ts: Date.now(), kind, from, text, ...(to ? { to } : {}), ...(title ? { title } : {}) };
    this.persistence.appendBoard(post);
    this.emit({ type: 'board', post });
  }
}
