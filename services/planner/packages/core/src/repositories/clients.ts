import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { Client, ClientStage } from "@planner-life/shared";

interface ClientRow {
  id: string;
  name: string;
  stage: ClientStage;
  value: number;
  next_action: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage,
    value: row.value,
    nextAction: row.next_action ?? undefined,
    nextActionAt: row.next_action_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createClient(
  db: PlannerDb,
  input: { name: string; stage?: ClientStage; value?: number; nextAction?: string; nextActionAt?: string }
): Client {
  const now = new Date().toISOString();
  const row: ClientRow = {
    id: randomUUID(),
    name: input.name,
    stage: input.stage ?? "lead",
    value: input.value ?? 0,
    next_action: input.nextAction ?? null,
    next_action_at: input.nextActionAt ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO clients (id, name, stage, value, next_action, next_action_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.name,
    row.stage,
    row.value,
    row.next_action,
    row.next_action_at,
    row.created_at,
    row.updated_at
  );
  return rowToClient(row);
}

export function listClients(db: PlannerDb): Client[] {
  const rows = db
    .prepare(`SELECT * FROM clients ORDER BY created_at DESC`)
    .all() as unknown as ClientRow[];
  return rows.map(rowToClient);
}

export function getClient(db: PlannerDb, id: string): Client | undefined {
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id) as ClientRow | undefined;
  return row ? rowToClient(row) : undefined;
}

export function updateClient(
  db: PlannerDb,
  id: string,
  input: { stage?: ClientStage; value?: number; nextAction?: string; nextActionAt?: string }
): Client | undefined {
  const current = getClient(db, id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE clients SET stage = ?, value = ?, next_action = ?, next_action_at = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.stage ?? current.stage,
    input.value ?? current.value,
    input.nextAction ?? current.nextAction ?? null,
    input.nextActionAt ?? current.nextActionAt ?? null,
    now,
    id
  );
  return getClient(db, id);
}

export function deleteClient(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM clients WHERE id = ?`).run(id);
}
