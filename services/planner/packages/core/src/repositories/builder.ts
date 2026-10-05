import type { PlannerDb } from '../db';
import type {
  Block,
  BlockPermissions,
  BlockSource,
  Dashboard,
  DashboardItem,
  DashboardMode,
} from '@planner-life/shared';

interface BlockRow {
  id: string;
  name: string;
  description: string | null;
  html: string;
  css: string;
  js: string;
  permissions: string;
  refresh_seconds: number;
  source: string;
  approved: number;
  created_at: string;
  updated_at: string;
}

interface DashboardRow {
  id: string;
  name: string;
  mode: string;
  items: string;
  builtin: number;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToBlock(row: BlockRow): Block {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    html: row.html,
    css: row.css,
    js: row.js,
    permissions: parseJson<BlockPermissions>(row.permissions, { read: [], write: [], tools: [] }),
    refreshSeconds: row.refresh_seconds,
    source: row.source as BlockSource,
    approved: row.approved === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDashboard(row: DashboardRow): Dashboard {
  return {
    id: row.id,
    name: row.name,
    mode: (row.mode === 'canvas' ? 'canvas' : 'grid') as DashboardMode,
    items: parseJson<DashboardItem[]>(row.items, []),
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listBlocks(db: PlannerDb): Block[] {
  const rows = db
    .prepare(`SELECT * FROM blocks ORDER BY (source = 'builtin') DESC, name COLLATE NOCASE ASC`)
    .all() as unknown as BlockRow[];
  return rows.map(rowToBlock);
}

export function getBlock(db: PlannerDb, id: string): Block | undefined {
  const row = db.prepare(`SELECT * FROM blocks WHERE id = ?`).get(id) as BlockRow | undefined;
  return row ? rowToBlock(row) : undefined;
}

/** Insere ou substitui o bloco inteiro (mantem created_at se ja existir). */
export function saveBlock(db: PlannerDb, block: Block): Block {
  db.prepare(
    `INSERT INTO blocks (id, name, description, html, css, js, permissions, refresh_seconds, source, approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, description = excluded.description, html = excluded.html, css = excluded.css,
       js = excluded.js, permissions = excluded.permissions, refresh_seconds = excluded.refresh_seconds,
       source = excluded.source, approved = excluded.approved, updated_at = excluded.updated_at`,
  ).run(
    block.id,
    block.name,
    block.description ?? null,
    block.html,
    block.css,
    block.js,
    JSON.stringify(block.permissions),
    block.refreshSeconds,
    block.source,
    block.approved ? 1 : 0,
    block.createdAt,
    block.updatedAt,
  );
  return getBlock(db, block.id)!;
}

export function deleteBlock(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM blocks WHERE id = ?`).run(id);
}

export function listDashboards(db: PlannerDb): Dashboard[] {
  const rows = db
    .prepare(`SELECT * FROM dashboards ORDER BY builtin DESC, created_at ASC`)
    .all() as unknown as DashboardRow[];
  return rows.map(rowToDashboard);
}

export function getDashboard(db: PlannerDb, id: string): Dashboard | undefined {
  const row = db.prepare(`SELECT * FROM dashboards WHERE id = ?`).get(id) as
    DashboardRow | undefined;
  return row ? rowToDashboard(row) : undefined;
}

export function saveDashboard(db: PlannerDb, dashboard: Dashboard): Dashboard {
  db.prepare(
    `INSERT INTO dashboards (id, name, mode, items, builtin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, mode = excluded.mode, items = excluded.items, builtin = excluded.builtin, updated_at = excluded.updated_at`,
  ).run(
    dashboard.id,
    dashboard.name,
    dashboard.mode,
    JSON.stringify(dashboard.items),
    dashboard.builtin ? 1 : 0,
    dashboard.createdAt,
    dashboard.updatedAt,
  );
  return getDashboard(db, dashboard.id)!;
}

export function deleteDashboard(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM dashboards WHERE id = ?`).run(id);
}
