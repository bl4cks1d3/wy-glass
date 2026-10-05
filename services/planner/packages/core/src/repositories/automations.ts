import type { PlannerDb } from '../db';
import type {
  Automation,
  AutomationEdge,
  AutomationNode,
  AutomationNodeLog,
  AutomationRun,
  AutomationRunStatus,
  AutomationSource,
} from '@planner-life/shared';

interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  graph: string;
  active: number;
  source: string;
  last_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  automation_id: string;
  status: string;
  mode: string;
  trigger_node: string;
  trigger_type: string;
  trigger_payload: string;
  nodes: string;
  error: string | null;
  started_at: string;
  finished_at: string;
}

/** Quantas execucoes guardar por automacao (as mais antigas saem). */
const KEEP_RUNS = 50;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToAutomation(row: AutomationRow): Automation {
  const graph = parseJson<{ nodes?: AutomationNode[]; edges?: AutomationEdge[] }>(row.graph, {});
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
    active: row.active === 1,
    source: row.source as AutomationSource,
    lastRunAt: row.last_run_at ?? undefined,
    lastStatus: (row.last_status as AutomationRunStatus | null) ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    status: row.status as AutomationRunStatus,
    mode: row.mode === 'dry' ? 'dry' : 'live',
    triggerNodeId: row.trigger_node,
    triggerType: row.trigger_type,
    triggerPayload: parseJson<Record<string, unknown>>(row.trigger_payload, {}),
    nodes: parseJson<AutomationNodeLog[]>(row.nodes, []),
    error: row.error ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function listAutomations(db: PlannerDb): Automation[] {
  const rows = db
    .prepare(`SELECT * FROM automations ORDER BY created_at ASC`)
    .all() as unknown as AutomationRow[];
  return rows.map(rowToAutomation);
}

export function listActiveAutomations(db: PlannerDb): Automation[] {
  const rows = db
    .prepare(`SELECT * FROM automations WHERE active = 1`)
    .all() as unknown as AutomationRow[];
  return rows.map(rowToAutomation);
}

export function getAutomation(db: PlannerDb, id: string): Automation | undefined {
  const row = db.prepare(`SELECT * FROM automations WHERE id = ?`).get(id) as
    AutomationRow | undefined;
  return row ? rowToAutomation(row) : undefined;
}

/** Insere ou substitui a definicao inteira (preserva created_at e o ultimo resultado). */
export function saveAutomation(db: PlannerDb, a: Automation): Automation {
  db.prepare(
    `INSERT INTO automations (id, name, description, graph, active, source, last_run_at, last_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, description = excluded.description, graph = excluded.graph,
       active = excluded.active, source = excluded.source, updated_at = excluded.updated_at`,
  ).run(
    a.id,
    a.name,
    a.description ?? null,
    JSON.stringify({ nodes: a.nodes, edges: a.edges }),
    a.active ? 1 : 0,
    a.source,
    a.lastRunAt ?? null,
    a.lastStatus ?? null,
    a.createdAt,
    a.updatedAt,
  );
  return getAutomation(db, a.id)!;
}

export function setActive(db: PlannerDb, id: string, active: boolean, updatedAt: string): void {
  db.prepare(`UPDATE automations SET active = ?, updated_at = ? WHERE id = ?`).run(
    active ? 1 : 0,
    updatedAt,
    id,
  );
}

export function deleteAutomation(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM automation_runs WHERE automation_id = ?`).run(id);
  db.prepare(`DELETE FROM automations WHERE id = ?`).run(id);
}

export function saveRun(db: PlannerDb, run: AutomationRun): void {
  db.prepare(
    `INSERT INTO automation_runs (id, automation_id, status, mode, trigger_node, trigger_type, trigger_payload, nodes, error, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.id,
    run.automationId,
    run.status,
    run.mode,
    run.triggerNodeId,
    run.triggerType,
    JSON.stringify(run.triggerPayload),
    JSON.stringify(run.nodes),
    run.error ?? null,
    run.startedAt,
    run.finishedAt,
  );
  // so execucoes de verdade mexem no "ultimo resultado" da automacao (sem mudar updated_at)
  if (run.mode === 'live') {
    db.prepare(`UPDATE automations SET last_run_at = ?, last_status = ? WHERE id = ?`).run(
      run.finishedAt,
      run.status,
      run.automationId,
    );
  }
  db.prepare(
    `DELETE FROM automation_runs WHERE automation_id = ? AND id NOT IN (
       SELECT id FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?
     )`,
  ).run(run.automationId, run.automationId, KEEP_RUNS);
}

export function listRuns(
  db: PlannerDb,
  automationId: string | undefined,
  limit: number,
): AutomationRun[] {
  const rows = (automationId
    ? db
        .prepare(
          `SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?`,
        )
        .all(automationId, limit)
    : db
        .prepare(`SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT ?`)
        .all(limit)) as unknown as RunRow[];
  return rows.map(rowToRun);
}

export function getRun(db: PlannerDb, id: string): AutomationRun | undefined {
  const row = db.prepare(`SELECT * FROM automation_runs WHERE id = ?`).get(id) as
    RunRow | undefined;
  return row ? rowToRun(row) : undefined;
}
