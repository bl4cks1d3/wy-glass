import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { PlannerEvent, PlpEventType } from "@planner-life/shared";

interface EventRow {
  id: string;
  type: string;
  payload: string;
  origin: string;
  created_at: string;
}

function rowToEvent(row: EventRow): PlannerEvent {
  return {
    id: row.id,
    type: row.type as PlpEventType,
    payload: JSON.parse(row.payload),
    origin: row.origin,
    createdAt: row.created_at,
  };
}

export function recordEvent(
  db: PlannerDb,
  type: PlpEventType,
  payload: Record<string, unknown>,
  origin = "planner-core"
): PlannerEvent {
  const now = new Date().toISOString();
  const row: EventRow = {
    id: randomUUID(),
    type,
    payload: JSON.stringify(payload),
    origin,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO events (id, type, payload, origin, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.type, row.payload, row.origin, row.created_at);
  return rowToEvent(row);
}

export function listEvents(db: PlannerDb, limit = 50): PlannerEvent[] {
  const rows = db
    .prepare(`SELECT * FROM events ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as EventRow[];
  return rows.map(rowToEvent);
}
