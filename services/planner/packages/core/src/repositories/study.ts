import { randomUUID } from "node:crypto";
import type { PlannerDb } from "../db";
import type { ScheduleBlock, StudySession, StudyTopic } from "@planner-life/shared";

interface TopicRow {
  id: string;
  subject_id: string;
  title: string;
  done: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTopic(row: TopicRow): StudyTopic {
  return {
    id: row.id,
    subjectId: row.subject_id,
    title: row.title,
    done: row.done === 1,
    dueAt: row.due_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createTopic(db: PlannerDb, input: { subjectId: string; title: string; dueAt?: string }): StudyTopic {
  const now = new Date().toISOString();
  const row: TopicRow = {
    id: randomUUID(),
    subject_id: input.subjectId,
    title: input.title,
    done: 0,
    due_at: input.dueAt ?? null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO study_topics (id, subject_id, title, done, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.subject_id, row.title, row.done, row.due_at, row.created_at, row.updated_at);
  return rowToTopic(row);
}

export function listTopics(db: PlannerDb, subjectId?: string): StudyTopic[] {
  const sql = subjectId
    ? `SELECT * FROM study_topics WHERE subject_id = ? ORDER BY created_at ASC`
    : `SELECT * FROM study_topics ORDER BY created_at ASC`;
  const rows = (subjectId ? db.prepare(sql).all(subjectId) : db.prepare(sql).all()) as unknown as TopicRow[];
  return rows.map(rowToTopic);
}

export function setTopicDone(db: PlannerDb, id: string, done: boolean): StudyTopic | undefined {
  const now = new Date().toISOString();
  db.prepare(`UPDATE study_topics SET done = ?, updated_at = ? WHERE id = ?`).run(done ? 1 : 0, now, id);
  const row = db.prepare(`SELECT * FROM study_topics WHERE id = ?`).get(id) as TopicRow | undefined;
  return row ? rowToTopic(row) : undefined;
}

export function deleteTopic(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM study_topics WHERE id = ?`).run(id);
}

interface ScheduleRow {
  id: string;
  subject_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  created_at: string;
}

function rowToBlock(row: ScheduleRow): ScheduleBlock {
  return {
    id: row.id,
    subjectId: row.subject_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    createdAt: row.created_at,
  };
}

export function createScheduleBlock(
  db: PlannerDb,
  input: { subjectId: string; dayOfWeek: number; startTime: string; endTime: string }
): ScheduleBlock {
  const now = new Date().toISOString();
  const row: ScheduleRow = {
    id: randomUUID(),
    subject_id: input.subjectId,
    day_of_week: input.dayOfWeek,
    start_time: input.startTime,
    end_time: input.endTime,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO schedule_blocks (id, subject_id, day_of_week, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.subject_id, row.day_of_week, row.start_time, row.end_time, row.created_at);
  return rowToBlock(row);
}

export function listScheduleBlocks(db: PlannerDb): ScheduleBlock[] {
  const rows = db
    .prepare(`SELECT * FROM schedule_blocks ORDER BY day_of_week ASC, start_time ASC`)
    .all() as unknown as ScheduleRow[];
  return rows.map(rowToBlock);
}

export function deleteScheduleBlock(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM schedule_blocks WHERE id = ?`).run(id);
}

interface SessionRow {
  id: string;
  subject_id: string | null;
  duration_minutes: number;
  started_at: string;
  ended_at: string;
  created_at: string;
}

function rowToSession(row: SessionRow): StudySession {
  return {
    id: row.id,
    subjectId: row.subject_id ?? undefined,
    durationMinutes: row.duration_minutes,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export function createSession(
  db: PlannerDb,
  input: { subjectId?: string; durationMinutes: number; startedAt: string; endedAt: string }
): StudySession {
  const now = new Date().toISOString();
  const row: SessionRow = {
    id: randomUUID(),
    subject_id: input.subjectId ?? null,
    duration_minutes: input.durationMinutes,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    created_at: now,
  };
  db.prepare(
    `INSERT INTO study_sessions (id, subject_id, duration_minutes, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.subject_id, row.duration_minutes, row.started_at, row.ended_at, row.created_at);
  return rowToSession(row);
}

export function listSessions(db: PlannerDb, sinceDays = 30): StudySession[] {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const rows = db
    .prepare(`SELECT * FROM study_sessions WHERE started_at >= ? ORDER BY started_at DESC`)
    .all(since) as unknown as SessionRow[];
  return rows.map(rowToSession);
}

export function deleteSession(db: PlannerDb, id: string): void {
  db.prepare(`DELETE FROM study_sessions WHERE id = ?`).run(id);
}
