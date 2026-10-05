import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { Task, TaskStatus } from "@planner-life/shared";

interface TaskRow {
  id: string;
  title: string;
  project_id: string | null;
  status: TaskStatus;
  due_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id ?? undefined,
    status: row.status,
    dueAt: row.due_at ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTask(
  db: PlannerDb,
  input: { title: string; projectId?: string; dueAt?: string; notes?: string }
): Task {
  const now = new Date().toISOString();
  const row: TaskRow = {
    id: randomUUID(),
    title: input.title,
    project_id: input.projectId ?? null,
    status: "pending",
    due_at: input.dueAt ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO tasks (id, title, project_id, status, due_at, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.title,
    row.project_id,
    row.status,
    row.due_at,
    row.notes,
    row.created_at,
    row.updated_at
  );
  return rowToTask(row);
}

export function listTasks(
  db: PlannerDb,
  filter?: { status?: TaskStatus; projectId?: string }
): Task[] {
  let sql = `SELECT * FROM tasks WHERE 1=1`;
  const params: string[] = [];
  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  if (filter?.projectId) {
    sql += ` AND project_id = ?`;
    params.push(filter.projectId);
  }
  sql += ` ORDER BY due_at IS NULL, due_at ASC, created_at DESC`;
  const rows = db.prepare(sql).all(...params) as unknown as TaskRow[];
  return rows.map(rowToTask);
}

export function getTask(db: PlannerDb, id: string): Task | undefined {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
    | TaskRow
    | undefined;
  return row ? rowToTask(row) : undefined;
}

export function updateTaskStatus(
  db: PlannerDb,
  id: string,
  status: TaskStatus
): Task | undefined {
  const now = new Date().toISOString();
  db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(
    status,
    now,
    id
  );
  return getTask(db, id);
}

export function updateTask(
  db: PlannerDb,
  id: string,
  input: { title?: string; projectId?: string | null; dueAt?: string | null; notes?: string | null }
): Task | undefined {
  const current = getTask(db, id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE tasks SET title = ?, project_id = ?, due_at = ?, notes = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.title ?? current.title,
    input.projectId !== undefined ? input.projectId : (current.projectId ?? null),
    input.dueAt !== undefined ? input.dueAt : (current.dueAt ?? null),
    input.notes !== undefined ? input.notes : (current.notes ?? null),
    now,
    id
  );
  return getTask(db, id);
}

export function deleteTask(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}
