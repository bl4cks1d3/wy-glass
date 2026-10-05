import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { Habit } from "@planner-life/shared";

interface HabitRow {
  id: string;
  name: string;
  unit: string;
  target: number;
  current: number;
  created_at: string;
  updated_at: string;
}

function rowToHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    target: row.target,
    current: row.current,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createHabit(
  db: PlannerDb,
  input: { name: string; unit?: string; target?: number }
): Habit {
  const now = new Date().toISOString();
  const row: HabitRow = {
    id: randomUUID(),
    name: input.name,
    unit: input.unit ?? "",
    target: input.target ?? 0,
    current: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO habits (id, name, unit, target, current, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.unit, row.target, row.current, row.created_at, row.updated_at);
  return rowToHabit(row);
}

export function listHabits(db: PlannerDb): Habit[] {
  const rows = db.prepare(`SELECT * FROM habits ORDER BY created_at ASC`).all() as unknown as HabitRow[];
  return rows.map(rowToHabit);
}

export function getHabit(db: PlannerDb, id: string): Habit | undefined {
  const row = db.prepare(`SELECT * FROM habits WHERE id = ?`).get(id) as HabitRow | undefined;
  return row ? rowToHabit(row) : undefined;
}

export function updateHabit(
  db: PlannerDb,
  id: string,
  input: { current?: number; target?: number }
): Habit | undefined {
  const current = getHabit(db, id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(`UPDATE habits SET current = ?, target = ?, updated_at = ? WHERE id = ?`).run(
    input.current ?? current.current,
    input.target ?? current.target,
    now,
    id
  );
  return getHabit(db, id);
}

export function deleteHabit(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM habits WHERE id = ?`).run(id);
}
