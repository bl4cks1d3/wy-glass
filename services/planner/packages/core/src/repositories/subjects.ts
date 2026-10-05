import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { Subject } from "@planner-life/shared";

interface SubjectRow {
  id: string;
  name: string;
  progress: number;
  note: string | null;
  exam_date: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    name: row.name,
    progress: row.progress,
    note: row.note ?? undefined,
    examDate: row.exam_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSubject(db: PlannerDb, input: { name: string; note?: string; examDate?: string }): Subject {
  const now = new Date().toISOString();
  const row: SubjectRow = {
    id: randomUUID(),
    name: input.name,
    progress: 0,
    note: input.note ?? null,
    exam_date: input.examDate ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO subjects (id, name, progress, note, exam_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.progress, row.note, row.exam_date, row.created_at, row.updated_at);
  return rowToSubject(row);
}

export function listSubjects(db: PlannerDb): Subject[] {
  const rows = db
    .prepare(`SELECT * FROM subjects ORDER BY created_at DESC`)
    .all() as unknown as SubjectRow[];
  return rows.map(rowToSubject);
}

export function getSubject(db: PlannerDb, id: string): Subject | undefined {
  const row = db.prepare(`SELECT * FROM subjects WHERE id = ?`).get(id) as SubjectRow | undefined;
  return row ? rowToSubject(row) : undefined;
}

export function updateSubject(
  db: PlannerDb,
  id: string,
  input: { progress?: number; note?: string; examDate?: string | null }
): Subject | undefined {
  const current = getSubject(db, id);
  if (!current) return undefined;
  const now = new Date().toISOString();
  db.prepare(`UPDATE subjects SET progress = ?, note = ?, exam_date = ?, updated_at = ? WHERE id = ?`).run(
    input.progress ?? current.progress,
    input.note ?? current.note ?? null,
    input.examDate === undefined ? (current.examDate ?? null) : input.examDate,
    now,
    id
  );
  return getSubject(db, id);
}

export function deleteSubject(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM study_topics WHERE subject_id = ?`).run(id);
  db.prepare(`DELETE FROM schedule_blocks WHERE subject_id = ?`).run(id);
  db.prepare(`DELETE FROM subjects WHERE id = ?`).run(id);
}
