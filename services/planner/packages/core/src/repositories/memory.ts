import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { MemoryEntry } from "@planner-life/shared";

interface MemoryRow {
  id: string;
  content: string;
  tags: string;
  source: string;
  created_at: string;
}

function rowToMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    tags: JSON.parse(row.tags),
    source: row.source,
    createdAt: row.created_at,
  };
}

export function createMemory(
  db: PlannerDb,
  input: { content: string; tags?: string[]; source?: string }
): MemoryEntry {
  const now = new Date().toISOString();
  const row: MemoryRow = {
    id: randomUUID(),
    content: input.content,
    tags: JSON.stringify(input.tags ?? []),
    source: input.source ?? "user",
    created_at: now,
  };
  db.prepare(
    `INSERT INTO memory_entries (id, content, tags, source, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.content, row.tags, row.source, row.created_at);
  return rowToMemory(row);
}

export function listMemory(db: PlannerDb, limit = 100): MemoryEntry[] {
  const rows = db
    .prepare(`SELECT * FROM memory_entries ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as unknown as MemoryRow[];
  return rows.map(rowToMemory);
}

export function deleteMemory(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM memory_entries WHERE id = ?`).run(id);
}
