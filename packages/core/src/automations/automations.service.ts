import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Automation,
  AutomationNode,
  AutomationRun,
  AutomationSource,
} from '@planner-life/shared';
import type { PlannerDb } from '../db';
import { PLANNER_DB } from '../database/database.module';
import { PlannerEventBus } from '../eventBus';
import { EventsService } from '../events/events.service';
import { DataService } from '../data/data.service';
import * as repo from '../repositories/automations';
import { AgentClient } from './agent-client';
import { BLOCKED_TOOLS, EVENT_CATALOG, LIMITS } from './catalog';
import { nextCronRun, parseCron } from './cron';
import { executeAutomation, type EngineDeps } from './engine';
import { autoLayout, normalizeGraph, validateGraph, type ValidationContext } from './graph';
import { NODE_SPECS, isTrigger } from './node-specs';

export type WithProblems = Automation & { problems: string[] };
type Body = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Assinatura do que importa (sem posicoes): so mudancas reais viram evento. */
function signature(a: Pick<Automation, 'name' | 'nodes' | 'edges' | 'active'>): string {
  return JSON.stringify([a.name, a.active, a.nodes.map((n) => ({ ...n, x: 0, y: 0 })), a.edges]);
}

@Injectable()
export class AutomationsService {
  private readonly running = new Set<string>();
  private inflight = 0;

  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus,
    private readonly agent: AgentClient,
    private readonly data: DataService,
  ) {}

  // ---------------------------------------------------------------- consulta

  list(): Automation[] {
    return repo.listAutomations(this.db).map((a) => ({ ...a, nextRunAt: this.nextRunAt(a) }));
  }

  async get(id: string): Promise<WithProblems> {
    const a = this.find(id);
    return { ...a, nextRunAt: this.nextRunAt(a), problems: await this.problemsOf(a) };
  }

  find(id: string): Automation {
    const a = repo.getAutomation(this.db, id);
    if (!a) throw new NotFoundException('automacao nao encontrada');
    return a;
  }

  async catalog() {
    const tools = await this.agent.listTools();
    return {
      nodes: NODE_SPECS,
      events: EVENT_CATALOG,
      tools: tools
        ?.filter((t) => !BLOCKED_TOOLS.has(t.name))
        .map((t) => ({
          name: t.name,
          description: t.description,
          params: Object.keys(t.inputSchema?.properties ?? {}),
          required: t.inputSchema?.required ?? [],
        })),
      collections: this.data
        .listCollections()
        .map((c) => ({ name: c.name, label: c.label, fields: c.fields.map((f) => f.name) })),
      limits: LIMITS,
    };
  }

  runs(id: string, limit: number): AutomationRun[] {
    this.find(id);
    return repo.listRuns(this.db, id, Math.min(50, Math.max(1, limit || 20)));
  }

  getRun(runId: string): AutomationRun {
    const run = repo.getRun(this.db, runId);
    if (!run) throw new NotFoundException('execucao nao encontrada');
    return run;
  }

  // ---------------------------------------------------------------- escrita

  async create(input: Body): Promise<WithProblems> {
    const built = await this.build(input, undefined);
    const now = new Date().toISOString();
    const a: Automation = { id: randomUUID(), ...built, createdAt: now, updatedAt: now };
    const saved = repo.saveAutomation(this.db, a);
    this.emit('automation.created', {
      automationId: saved.id,
      name: saved.name,
      source: saved.source,
    });
    return { ...saved, problems: await this.problemsOf(saved) };
  }

  async update(id: string, input: Body): Promise<WithProblems> {
    const current = this.find(id);
    if (typeof input.baseUpdatedAt === 'string' && input.baseUpdatedAt !== current.updatedAt) {
      throw new ConflictException('automacao alterada em outro lugar; recarregue');
    }
    const built = await this.build(input, current);
    const next: Automation = {
      ...current,
      ...built,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const saved = repo.saveAutomation(this.db, next);
    if (signature(current) !== signature(saved))
      this.emit('automation.updated', {
        automationId: saved.id,
        name: saved.name,
        source: saved.source,
        active: saved.active,
      });
    return { ...saved, problems: await this.problemsOf(saved) };
  }

  async setActive(id: string, active: boolean): Promise<WithProblems> {
    const current = this.find(id);
    if (active) {
      const problems = await this.problemsOf(current);
      if (problems.length) throw new BadRequestException(['Corrija antes de ativar:', ...problems]);
      if (!current.nodes.some((n) => isTrigger(n.type)))
        throw new BadRequestException('adicione um gatilho antes de ativar');
    }
    repo.setActive(this.db, id, active, new Date().toISOString());
    const saved = this.find(id);
    this.emit('automation.updated', {
      automationId: id,
      name: saved.name,
      source: saved.source,
      active,
    });
    return { ...saved, nextRunAt: this.nextRunAt(saved), problems: [] };
  }

  remove(id: string) {
    const a = this.find(id);
    repo.deleteAutomation(this.db, id);
    this.emit('automation.deleted', { automationId: id, name: a.name });
    return { ok: true };
  }

  /** Lembrete/temporizador: automacao fixa (uma vez ou repetida) que so avisa. Nasce ativa (o usuario pediu). */
  async createReminder(input: {
    message?: unknown;
    at?: unknown;
    inMinutes?: unknown;
    repeat?: unknown;
  }): Promise<WithProblems> {
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 300) : '';
    if (!message) throw new BadRequestException('message e obrigatorio');
    let when: Date;
    if (input.inMinutes !== undefined && input.inMinutes !== null && input.inMinutes !== '') {
      const min = Number(input.inMinutes);
      if (!Number.isFinite(min) || min <= 0 || min > 60 * 24 * 365)
        throw new BadRequestException('inMinutes deve ser um numero positivo');
      when = new Date(Date.now() + min * 60_000);
    } else if (typeof input.at === 'string' && input.at) {
      when = new Date(input.at);
      if (Number.isNaN(when.getTime()))
        throw new BadRequestException('at invalido (use ISO, ex.: 2026-09-20T09:00)');
    } else {
      throw new BadRequestException('informe at (data/hora) ou inMinutes');
    }
    const repeat = typeof input.repeat === 'string' ? input.repeat : 'none';
    if (!['none', 'daily', 'weekdays', 'weekly'].includes(repeat))
      throw new BadRequestException('repeat: none, daily, weekdays ou weekly');
    if (repeat === 'none' && when.getTime() < Date.now() - 60_000)
      throw new BadRequestException('esse horario ja passou');

    const cron = `${when.getMinutes()} ${when.getHours()} * * ${repeat === 'weekly' ? when.getDay() : repeat === 'weekdays' ? '1-5' : '*'}`;
    const trigger: AutomationNode =
      repeat === 'none'
        ? {
            id: 'quando',
            type: 'trigger.once',
            name: 'Uma vez',
            x: 60,
            y: 60,
            config: { at: when.toISOString() },
          }
        : {
            id: 'quando',
            type: 'trigger.schedule',
            name: 'Repete',
            x: 60,
            y: 60,
            config: { cron },
          };
    const label = when.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const created = await this.create({
      name: `Lembrete: ${message.slice(0, 50)}`,
      description:
        repeat === 'none'
          ? `Avisa em ${label}`
          : `Avisa (${repeat}) às ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`,
      source: 'user',
      nodes: [
        trigger,
        {
          id: 'avisar',
          type: 'action.notify',
          name: 'Aviso',
          x: 340,
          y: 60,
          config: { title: 'Lembrete', message },
        },
      ],
      edges: [{ id: 'e1', from: 'quando', fromPort: 'main', to: 'avisar' }],
    });
    return this.setActive(created.id, true);
  }

  listReminders(): Automation[] {
    return this.list().filter((a) => a.name.startsWith('Lembrete:') && a.active);
  }

  // ---------------------------------------------------------------- execucao

  async run(
    id: string,
    opts: { mode?: unknown; triggerNodeId?: unknown; payload?: unknown },
  ): Promise<AutomationRun> {
    const a = this.find(id);
    const mode: 'live' | 'dry' = opts.mode === 'dry' ? 'dry' : 'live';
    const problems = await this.problemsOf(a);
    if (problems.length) throw new BadRequestException(['Corrija antes de executar:', ...problems]);
    const triggers = a.nodes.filter((n) => isTrigger(n.type));
    const trigger =
      typeof opts.triggerNodeId === 'string' && opts.triggerNodeId
        ? triggers.find((n) => n.id === opts.triggerNodeId)
        : (triggers.find((n) => n.type === 'trigger.manual') ?? triggers[0]);
    if (!trigger) throw new BadRequestException('a automacao nao tem gatilho');
    if (this.running.has(id)) throw new ConflictException('essa automacao ja esta executando');
    if (this.inflight >= LIMITS.concurrentRuns)
      throw new ConflictException('muitas automacoes executando ao mesmo tempo; tente de novo');
    const payload = isObject(opts.payload)
      ? opts.payload
      : isObject(trigger.config.payload)
        ? (trigger.config.payload as Record<string, unknown>)
        : {};

    this.running.add(id);
    this.inflight++;
    try {
      const run = await executeAutomation(
        a,
        { mode, triggerNodeId: trigger.id, payload },
        this.deps(),
      );
      repo.saveRun(this.db, run);
      return run;
    } finally {
      this.running.delete(id);
      this.inflight--;
    }
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** Marca o gatilho "uma vez" como disparado; sem outros gatilhos pendentes a automacao se desativa. */
  markOnceFired(id: string, nodeId: string): void {
    const a = repo.getAutomation(this.db, id);
    if (!a) return;
    const nodes = a.nodes.map((n) =>
      n.id === nodeId ? { ...n, config: { ...n.config, firedAt: new Date().toISOString() } } : n,
    );
    const pending = nodes.some(
      (n) =>
        (n.type === 'trigger.once' && !n.config.firedAt) ||
        n.type === 'trigger.schedule' ||
        n.type === 'trigger.event',
    );
    repo.saveAutomation(this.db, {
      ...a,
      nodes,
      active: pending ? a.active : false,
      updatedAt: new Date().toISOString(),
    });
  }

  deactivate(id: string): void {
    repo.setActive(this.db, id, false, new Date().toISOString());
  }

  activeAutomations(): Automation[] {
    return repo.listActiveAutomations(this.db);
  }

  // ---------------------------------------------------------------- interno

  private async build(input: Body, current: Automation | undefined) {
    const name = input.name !== undefined ? String(input.name ?? '').trim() : (current?.name ?? '');
    if (!name) throw new BadRequestException('name e obrigatorio');
    if (name.length > 80) throw new BadRequestException('name passa do limite de 80 caracteres');
    const source: AutomationSource =
      input.source === 'agent'
        ? 'agent'
        : input.source === 'user'
          ? 'user'
          : (current?.source ?? 'user');
    const strict = source === 'agent' || input.strict === true;

    let nodes = current?.nodes ?? [];
    let edges = current?.edges ?? [];
    let shape: string[] = [];
    if (input.nodes !== undefined || input.edges !== undefined) {
      let g;
      try {
        g = normalizeGraph({ nodes: input.nodes ?? nodes, edges: input.edges ?? edges });
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
      ({ nodes, edges } = g);
      shape = g.problems;
      autoLayout(nodes, edges);
    }
    if (JSON.stringify({ nodes, edges }).length > LIMITS.definitionChars)
      throw new BadRequestException('automacao grande demais');

    if (strict) {
      const problems = [...shape, ...validateGraph(nodes, edges, await this.validationContext())];
      if (problems.length) throw new BadRequestException(['Corrija e envie de novo:', ...problems]);
    }
    // o agente nunca liga: editar ou criar como agente deixa desativada (so o usuario ativa)
    const active = source === 'agent' ? false : (current?.active ?? false);
    const description =
      input.description !== undefined
        ? String(input.description ?? '').slice(0, 500) || undefined
        : current?.description;
    return {
      name,
      description,
      nodes,
      edges,
      active,
      source,
      lastRunAt: current?.lastRunAt,
      lastStatus: current?.lastStatus,
    };
  }

  private async validationContext(): Promise<ValidationContext> {
    const tools = await this.agent.listTools();
    return {
      tools,
      hasCollection: (name) => {
        try {
          this.data.getCollection(name);
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  private async problemsOf(a: Automation): Promise<string[]> {
    return validateGraph(a.nodes, a.edges, await this.validationContext());
  }

  nextRunAt(a: Automation): string | undefined {
    if (!a.active) return undefined;
    const now = new Date();
    const candidates: number[] = [];
    for (const n of a.nodes) {
      if (n.type === 'trigger.schedule' && typeof n.config.cron === 'string') {
        try {
          const next = nextCronRun(parseCron(n.config.cron), now);
          if (next) candidates.push(next.getTime());
        } catch {
          // cron invalido: ja aparece em "problems"
        }
      } else if (
        n.type === 'trigger.once' &&
        typeof n.config.at === 'string' &&
        !n.config.firedAt
      ) {
        const at = new Date(n.config.at).getTime();
        if (!Number.isNaN(at)) candidates.push(Math.max(at, now.getTime()));
      }
    }
    return candidates.length ? new Date(Math.min(...candidates)).toISOString() : undefined;
  }

  private deps(): EngineDeps {
    return {
      callTool: async (name, args) => {
        if (BLOCKED_TOOLS.has(name))
          throw new Error(`a ferramenta ${name} nao pode ser usada em automacoes`);
        return this.agent.callTool(name, args);
      },
      notify: (title, body) => this.agent.notify(title, body),
      chat: (prompt) => this.agent.chat(prompt),
      createRecord: (collection, data) => this.data.createRecord(collection, data),
      listRecords: (collection, query) => this.data.listRecords(collection, query),
    };
  }

  private emit(
    type: 'automation.created' | 'automation.updated' | 'automation.deleted',
    payload: Record<string, unknown>,
  ) {
    this.eventsService.record(type, payload);
    this.eventBus.publish(type, payload);
  }
}
