import { randomUUID } from 'node:crypto';
import type {
  Automation,
  AutomationEdge,
  AutomationNode,
  AutomationNodeLog,
  AutomationRun,
  AutomationRunStatus,
} from '@planner-life/shared';
import { LIMITS, isReadOnlyTool } from './catalog';
import { evalCondition, resolveDeep, stringify, type Ctx } from './expr';
import { isTrigger } from './node-specs';

export type Item = Record<string, unknown>;

/** Tudo que o motor precisa do mundo fora do grafo (injetado: facilita testar). */
export interface EngineDeps {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  notify(title: string, body: string): Promise<void>;
  chat(prompt: string): Promise<string>;
  createRecord(collection: string, data: Record<string, unknown>): Item;
  listRecords(collection: string, query: Record<string, string | undefined>): Item[];
}

export interface RunOptions {
  mode: 'live' | 'dry';
  triggerNodeId: string;
  payload: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const toItem = (v: unknown): Item => (isObject(v) ? v : { value: v });
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function nowCtx(): Record<string, unknown> {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    iso: d.toISOString(),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    weekday: d.getDay(),
  };
}

/** Resultado de ferramenta -> itens: lista vira um item por elemento; JSON em texto e lido. */
function resultToItems(value: unknown): Item[] {
  let v = value;
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try {
      v = JSON.parse(v);
    } catch {
      // continua texto
    }
  }
  if (Array.isArray(v)) return v.map(toItem);
  if (isObject(v)) return [v];
  return [{ result: v ?? null }];
}

function sample(items: Item[]): unknown[] {
  return items.slice(0, LIMITS.sampleItems).map((item) => {
    const text = JSON.stringify(item);
    return text.length > LIMITS.sampleChars
      ? { _cortado: text.slice(0, LIMITS.sampleChars) }
      : item;
  });
}

export async function executeAutomation(
  automation: Automation,
  opts: RunOptions,
  deps: EngineDeps,
): Promise<AutomationRun> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const byId = new Map<string, AutomationNode>(automation.nodes.map((n) => [n.id, n]));
  const trigger = byId.get(opts.triggerNodeId);
  const base = {
    id: randomUUID(),
    automationId: automation.id,
    mode: opts.mode,
    triggerNodeId: opts.triggerNodeId,
    triggerType: trigger?.type ?? 'desconhecido',
    triggerPayload: opts.payload,
  };
  const finish = (
    status: AutomationRunStatus,
    nodes: AutomationNodeLog[],
    error?: string,
  ): AutomationRun => ({
    ...base,
    status,
    nodes,
    ...(error ? { error } : {}),
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  if (!trigger || !isTrigger(trigger.type)) return finish('error', [], 'gatilho não encontrado');

  // subgrafo alcancavel a partir do gatilho, em ordem topologica
  const out = new Map<string, AutomationEdge[]>();
  const inc = new Map<string, AutomationEdge[]>();
  for (const e of automation.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e);
  }
  const reach = new Set<string>([trigger.id]);
  const stack = [trigger.id];
  while (stack.length)
    for (const e of out.get(stack.pop()!) ?? [])
      if (!reach.has(e.to)) (reach.add(e.to), stack.push(e.to));
  const indeg = new Map<string, number>();
  for (const id of reach)
    indeg.set(id, (inc.get(id) ?? []).filter((e) => reach.has(e.from)).length);
  const order: string[] = [];
  const ready = [...reach].filter((id) => (indeg.get(id) ?? 0) === 0);
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const e of out.get(id) ?? []) {
      if (!reach.has(e.to)) continue;
      indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1);
      if (indeg.get(e.to) === 0) ready.push(e.to);
    }
  }

  const outputs = new Map<string, Record<string, Item[]>>();
  const nodesCtx: Record<string, unknown> = {};
  const logs: AutomationNodeLog[] = [];
  let invocations = 0;
  let fatal: string | undefined;
  let partial = false;
  const dry = opts.mode === 'dry';

  const spend = () => {
    if (++invocations > LIMITS.invocations)
      throw new Error(`limite de ${LIMITS.invocations} chamadas por execução`);
  };

  for (const id of order) {
    if (fatal) break;
    if (Date.now() - t0 > LIMITS.runMs) {
      fatal = `tempo máximo de ${LIMITS.runMs / 60_000} min excedido`;
      break;
    }
    const node = byId.get(id)!;
    const log: AutomationNodeLog = {
      nodeId: id,
      name: node.name,
      type: node.type,
      status: 'ok',
      itemsIn: 0,
      itemsOut: {},
      durationMs: 0,
    };
    const warnings = new Set<string>();
    const warn = (m: string) => {
      if (warnings.size < 10) warnings.add(m);
    };
    const nodeStart = Date.now();

    const isStart = id === trigger.id;
    const inputs: Item[] = isStart
      ? [opts.payload]
      : (inc.get(id) ?? [])
          .filter((e) => reach.has(e.from))
          .flatMap((e) => outputs.get(e.from)?.[e.fromPort] ?? []);
    log.itemsIn = inputs.length;
    if (!isStart && inputs.length === 0) {
      log.status = 'skipped';
      outputs.set(id, {});
      logs.push({ ...log, durationMs: 0 });
      continue;
    }

    const ctxFor = (item: Item, index: number): Ctx => ({
      json: item,
      index,
      trigger: { type: trigger.type, payload: opts.payload },
      nodes: nodesCtx,
      now: nowCtx(),
    });
    const c = node.config;
    let ports: Record<string, Item[]> = {};
    let simulated = false;
    let failed = 0;

    /** Um item por vez: com onError=continue o item que falha e descartado. */
    const each = async (fn: (item: Item, index: number) => Promise<Item[]>): Promise<Item[]> => {
      const acc: Item[] = [];
      for (let i = 0; i < inputs.length; i++) {
        try {
          acc.push(...(await fn(inputs[i], i)));
        } catch (err) {
          if (node.onError === 'continue') {
            failed++;
            warn(`item ${i + 1}: ${errText(err)}`);
          } else {
            throw err;
          }
        }
      }
      return acc;
    };

    try {
      switch (node.type) {
        case 'trigger.manual':
        case 'trigger.schedule':
        case 'trigger.once':
        case 'trigger.event':
          ports = { main: inputs };
          break;
        case 'action.tool': {
          const tool = String(c.tool ?? '');
          ports = {
            main: await each(async (item, i) => {
              const args = resolveDeep(c.args ?? {}, ctxFor(item, i), warn) as Record<
                string,
                unknown
              >;
              if (dry && !isReadOnlyTool(tool)) {
                simulated = true;
                return [{ simulated: true, tool, args }];
              }
              spend();
              return resultToItems(await deps.callTool(tool, args));
            }),
          };
          break;
        }
        case 'action.notify':
          ports = {
            main: await each(async (item, i) => {
              const ctx = ctxFor(item, i);
              const title = stringify(
                resolveDeep(String(c.title || `Automação: ${automation.name}`), ctx, warn),
              );
              const message = stringify(resolveDeep(String(c.message ?? ''), ctx, warn));
              if (dry) {
                simulated = true;
                return [{ ...item, simulated: true, notified: { title, message } }];
              }
              spend();
              await deps.notify(title, message);
              return [item];
            }),
          };
          break;
        case 'action.agent':
          ports = {
            main: await each(async (item, i) => {
              const prompt = stringify(resolveDeep(String(c.prompt ?? ''), ctxFor(item, i), warn));
              if (dry) {
                simulated = true;
                return [{ simulated: true, prompt, reply: '(simulado)' }];
              }
              spend();
              return [{ reply: await deps.chat(prompt) }];
            }),
          };
          break;
        case 'action.record':
          ports = {
            main: await each(async (item, i) => {
              const data = resolveDeep(c.data ?? {}, ctxFor(item, i), warn) as Record<
                string,
                unknown
              >;
              if (dry) {
                simulated = true;
                return [{ simulated: true, collection: c.collection, data }];
              }
              spend();
              return [deps.createRecord(String(c.collection), data)];
            }),
          };
          break;
        case 'data.records': {
          const ctx = ctxFor(inputs[0] ?? {}, 0);
          const where = resolveDeep(c.where ?? {}, ctx, warn) as Record<string, unknown>;
          const query: Record<string, string | undefined> = {
            limit: String(Math.min(LIMITS.items, Math.max(1, Number(c.limit) || 100))),
          };
          for (const [k, v] of Object.entries(where)) query[k] = stringify(v);
          if (typeof c.q === 'string' && c.q) query.q = stringify(resolveDeep(c.q, ctx, warn));
          ports = { main: deps.listRecords(String(c.collection), query) };
          break;
        }
        case 'logic.if': {
          const t: Item[] = [];
          const f: Item[] = [];
          await each(async (item, i) => {
            (evalCondition(String(c.condition ?? ''), ctxFor(item, i)) ? t : f).push(item);
            return [];
          });
          ports = { true: t, false: f };
          break;
        }
        case 'logic.set':
          ports = {
            main: await each(async (item, i) => {
              const values = resolveDeep(c.values ?? {}, ctxFor(item, i), warn) as Item;
              return [c.only === 'sim' ? values : { ...item, ...values }];
            }),
          };
          break;
        default:
          throw new Error(`tipo de nó sem execução: ${node.type}`);
      }
      for (const [port, items] of Object.entries(ports)) {
        if (items.length > LIMITS.items) {
          warn(`${port}: ${items.length} itens; mantidos os primeiros ${LIMITS.items}`);
          ports[port] = items.slice(0, LIMITS.items);
        }
      }
      outputs.set(id, ports);
      nodesCtx[id] = { items: ports.main ?? Object.values(ports).flat(), ...ports };
      log.status = simulated ? 'simulated' : 'ok';
      log.itemsOut = Object.fromEntries(
        Object.entries(ports).map(([p, items]) => [p, items.length]),
      );
      log.input = sample(inputs);
      log.output = Object.fromEntries(
        Object.entries(ports).map(([p, items]) => [p, sample(items)]),
      );
      if (failed) {
        log.failed = failed;
        partial = true;
      }
    } catch (err) {
      log.status = 'error';
      log.error = errText(err);
      log.input = sample(inputs);
      outputs.set(id, {});
      if (node.onError === 'continue') partial = true;
      else fatal = `${node.name}: ${errText(err)}`;
    }
    if (warnings.size) log.warnings = [...warnings];
    log.durationMs = Date.now() - nodeStart;
    logs.push(log);
  }

  return finish(fatal ? 'error' : partial ? 'partial' : 'ok', logs, fatal);
}
