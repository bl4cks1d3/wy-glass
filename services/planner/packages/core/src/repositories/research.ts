import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { Paper, PaperStatus, ResearchLine } from "@planner-life/shared";

interface ResearchLineRow {
  id: string;
  name: string;
  stage: string | null;
  refs: number;
  next_step: string | null;
  created_at: string;
  updated_at: string;
}

interface PaperRow {
  id: string;
  title: string;
  source: string | null;
  status: PaperStatus;
  research_line_id: string | null;
  note_path: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLine(row: ResearchLineRow): ResearchLine {
  return {
    id: row.id,
    name: row.name,
    stage: row.stage ?? undefined,
    refs: row.refs,
    nextStep: row.next_step ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPaper(row: PaperRow): Paper {
  return {
    id: row.id,
    title: row.title,
    source: row.source ?? undefined,
    status: row.status,
    researchLineId: row.research_line_id ?? undefined,
    notePath: row.note_path ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createResearchLine(
  db: PlannerDb,
  input: { name: string; stage?: string; nextStep?: string }
): ResearchLine {
  const now = new Date().toISOString();
  const row: ResearchLineRow = {
    id: randomUUID(),
    name: input.name,
    stage: input.stage ?? null,
    refs: 0,
    next_step: input.nextStep ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO research_lines (id, name, stage, refs, next_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.stage, row.refs, row.next_step, row.created_at, row.updated_at);
  return rowToLine(row);
}

export function listResearchLines(db: PlannerDb): ResearchLine[] {
  const rows = db
    .prepare(`SELECT * FROM research_lines ORDER BY created_at DESC`)
    .all() as unknown as ResearchLineRow[];
  return rows.map(rowToLine);
}

export function getResearchLine(db: PlannerDb, id: string): ResearchLine | undefined {
  const row = db.prepare(`SELECT * FROM research_lines WHERE id = ?`).get(id) as
    | ResearchLineRow
    | undefined;
  return row ? rowToLine(row) : undefined;
}

export function updateResearchLine(
  db: PlannerDb,
  id: string,
  input: { stage?: string; nextStep?: string }
): ResearchLine | undefined {
  const current = getResearchLine(db, id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(`UPDATE research_lines SET stage = ?, next_step = ?, updated_at = ? WHERE id = ?`).run(
    input.stage ?? current.stage ?? null,
    input.nextStep ?? current.nextStep ?? null,
    now,
    id
  );
  return getResearchLine(db, id);
}

export function deleteResearchLine(db: PlannerDb, id: string): void {
  db.prepare(`UPDATE papers SET research_line_id = NULL WHERE research_line_id = ?`).run(id);
  db.prepare(`DELETE FROM research_lines WHERE id = ?`).run(id);
}

export function createPaper(
  db: PlannerDb,
  input: { title: string; source?: string; researchLineId?: string; status?: PaperStatus; notePath?: string }
): Paper {
  const now = new Date().toISOString();
  const row: PaperRow = {
    id: randomUUID(),
    title: input.title,
    source: input.source ?? null,
    status: input.status ?? "na_fila",
    research_line_id: input.researchLineId ?? null,
    note_path: input.notePath ?? null,
    created_at: now,
    updated_at: now,
  };
  if (row.research_line_id) {
    db.prepare(`UPDATE research_lines SET refs = refs + 1, updated_at = ? WHERE id = ?`).run(
      now,
      row.research_line_id
    );
  }
  db.prepare(
    `INSERT INTO papers (id, title, source, status, research_line_id, note_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.title,
    row.source,
    row.status,
    row.research_line_id,
    row.note_path,
    row.created_at,
    row.updated_at
  );
  return rowToPaper(row);
}

export function listPapers(db: PlannerDb, filter?: { researchLineId?: string }): Paper[] {
  let sql = `SELECT * FROM papers WHERE 1=1`;
  const params: string[] = [];
  if (filter?.researchLineId) {
    sql += ` AND research_line_id = ?`;
    params.push(filter.researchLineId);
  }
  sql += ` ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...params) as unknown as PaperRow[];
  return rows.map(rowToPaper);
}

export function getPaper(db: PlannerDb, id: string): Paper | undefined {
  const row = db.prepare(`SELECT * FROM papers WHERE id = ?`).get(id) as PaperRow | undefined;
  return row ? rowToPaper(row) : undefined;
}

export function updatePaperStatus(db: PlannerDb, id: string, status: PaperStatus): Paper | undefined {
  const now = new Date().toISOString();
  db.prepare(`UPDATE papers SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, id);
  return getPaper(db, id);
}

export function updatePaperNotePath(db: PlannerDb, id: string, notePath: string): Paper | undefined {
  const now = new Date().toISOString();
  db.prepare(`UPDATE papers SET note_path = ?, updated_at = ? WHERE id = ?`).run(notePath, now, id);
  return getPaper(db, id);
}

export function deletePaper(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM papers WHERE id = ?`).run(id);
}
