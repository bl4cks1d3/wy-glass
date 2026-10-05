import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { Project } from "@planner-life/shared";

interface ProjectRow {
  id: string;
  name: string;
  goal: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal ?? undefined,
    progress: row.progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createProject(
  db: PlannerDb,
  input: { name: string; goal?: string }
): Project {
  const now = new Date().toISOString();
  const row: ProjectRow = {
    id: randomUUID(),
    name: input.name,
    goal: input.goal ?? null,
    progress: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO projects (id, name, goal, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.goal, row.progress, row.created_at, row.updated_at);
  return rowToProject(row);
}

export function listProjects(db: PlannerDb): Project[] {
  const rows = db
    .prepare(`SELECT * FROM projects ORDER BY created_at DESC`)
    .all() as unknown as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(db: PlannerDb, id: string): Project | undefined {
  const row = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : undefined;
}

export function updateProjectProgress(
  db: PlannerDb,
  id: string,
  progress: number
): Project | undefined {
  const now = new Date().toISOString();
  db.prepare(`UPDATE projects SET progress = ?, updated_at = ? WHERE id = ?`).run(
    progress,
    now,
    id
  );
  return getProject(db, id);
}

export function updateProject(
  db: PlannerDb,
  id: string,
  input: { name?: string; goal?: string; progress?: number }
): Project | undefined {
  const current = getProject(db, id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(`UPDATE projects SET name = ?, goal = ?, progress = ?, updated_at = ? WHERE id = ?`).run(
    input.name ?? current.name,
    input.goal ?? current.goal ?? null,
    input.progress ?? current.progress,
    now,
    id
  );
  return getProject(db, id);
}

export function deleteProject(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM tasks WHERE project_id = ?`).run(id);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}
