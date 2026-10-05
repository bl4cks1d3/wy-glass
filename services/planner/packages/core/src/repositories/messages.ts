import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { InboxMessage } from "@planner-life/shared";

interface MessageRow {
  id: string;
  from_name: string;
  subject: string;
  snippet: string | null;
  tag: string | null;
  action: string | null;
  handled: number;
  received_at: string;
  created_at: string;
}

function rowToMessage(row: MessageRow): InboxMessage {
  return {
    id: row.id,
    from: row.from_name,
    subject: row.subject,
    snippet: row.snippet ?? undefined,
    tag: row.tag ?? undefined,
    action: row.action ?? undefined,
    handled: row.handled === 1,
    receivedAt: row.received_at,
    createdAt: row.created_at,
  };
}

export function upsertMessage(
  db: PlannerDb,
  input: {
    id?: string;
    from: string;
    subject: string;
    snippet?: string;
    tag?: string;
    action?: string;
    receivedAt: string;
  }
): InboxMessage {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO messages (id, from_name, subject, snippet, tag, action, handled, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       from_name = excluded.from_name,
       subject = excluded.subject,
       snippet = excluded.snippet,
       tag = excluded.tag,
       action = excluded.action,
       received_at = excluded.received_at`
  ).run(
    id,
    input.from,
    input.subject,
    input.snippet ?? null,
    input.tag ?? null,
    input.action ?? null,
    input.receivedAt,
    now
  );
  return getMessage(db, id) as InboxMessage;
}

export function listMessages(db: PlannerDb, limit = 50): InboxMessage[] {
  const rows = db
    .prepare(`SELECT * FROM messages ORDER BY received_at DESC LIMIT ?`)
    .all(limit) as unknown as MessageRow[];
  return rows.map(rowToMessage);
}

export function getMessage(db: PlannerDb, id: string): InboxMessage | undefined {
  const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined;
  return row ? rowToMessage(row) : undefined;
}

export function setMessageHandled(db: PlannerDb, id: string, handled: boolean): InboxMessage | undefined {
  db.prepare(`UPDATE messages SET handled = ? WHERE id = ?`).run(handled ? 1 : 0, id);
  return getMessage(db, id);
}

export function deleteMessage(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
}

/** So limpa a copia local (tabela messages) -- nunca mexe no Gmail de verdade. */
export function clearMessages(db: PlannerDb): number {
  const result = db.prepare(`DELETE FROM messages`).run();
  return Number(result.changes);
}
