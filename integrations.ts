import * as fs from 'fs';
import * as path from 'path';

/** Crossover with the user's other two systems, read-only:
 *  - Planner Life: its SQLite database directly (works with the Planner Core
 *    off), plus the Core HTTP API for the live Google Calendar when it is up.
 *  - My Current Brain: its SQLite database (brief, analyzed items, learning).
 *  Nothing here writes to either system; agents change data through their MCPs. */

const API_TIMEOUT_MS = 2_500;
const UPCOMING_DAYS = 14;
const DAY_MS = 86_400_000;

export interface HojeTask {
  id: string;
  title: string;
  dueAt: string | null;
  overdue: boolean;
}
export interface HojeEvent {
  title: string;
  start: string;
  end?: string;
  location?: string;
}
export interface HojeExam {
  subject: string;
  examDate: string;
  daysLeft: number;
}
export interface HojeClient {
  name: string;
  stage: string;
  value: number | null;
  nextAction: string | null;
  nextActionAt: string | null;
}
export interface HojeBrainItem {
  id: string;
  title: string;
  priority: string;
  why: string;
  url: string;
}

export interface HojeSnapshot {
  fetchedAt: number;
  planner: {
    /** 'api' = Core online; 'db' = read from the database (Core off); 'off' = not found. */
    source: 'api' | 'db' | 'off';
    error?: string;
    webUrl: string;
    events: HojeEvent[];
    calendarConnected: boolean;
    tasks: HojeTask[];
    projects: Array<{ name: string; progress: number; goal: string | null }>;
    clients: HojeClient[];
    pipelineValue: number;
    exams: HojeExam[];
    studyDue: Array<{ title: string; dueAt: string }>;
    habits: Array<{ name: string; current: number; target: number | null; unit: string }>;
    papersQueued: number;
    inboxUnhandled: number;
  };
  brain: {
    source: 'db' | 'off';
    error?: string;
    webUrl: string;
    brief: {
      date: string;
      headline: string;
      intro: string | null;
      nextMove: { title: string; action: string } | null;
    } | null;
    top: HojeBrainItem[];
    pending: number;
    unreadRelevant: number;
    learning: Array<{ title: string; track: string | null; progress: number }>;
    builds: Array<{ name: string; status: string; done: number; total: number }>;
  };
}

type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): {
    all(...params: unknown[]): Row[];
    get(...params: unknown[]): Row | undefined;
  };
  close(): void;
}

function openReadOnly(file: string): Db | null {
  if (!fs.existsSync(file)) return null;
  // node:sqlite is built in from Node 22.5; required lazily so an older
  // runtime only loses the crossover, not the whole server.
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (f: string, o: { readOnly: boolean }) => Db;
  };
  return new DatabaseSync(file, { readOnly: true });
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function safeAll(db: Db, sql: string, ...params: unknown[]): Row[] {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return []; // table/column missing in this version of the other app
  }
}
function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export interface IntegrationPaths {
  plannerDb: string | null;
  plannerApi: string;
  plannerWeb: string;
  brainDb: string | null;
  brainWeb: string;
}

/** Everything lives in this repo now: services/ (code) and data/ (the user's
 *  files). The .env (loaded at startup) may point elsewhere. */
export function resolveIntegrationPaths(officeRepoDir: string): IntegrationPaths {
  const data = path.join(officeRepoDir, 'data');
  return {
    plannerDb: process.env['DB_PATH'] ?? path.join(data, 'planner', 'planner.db'),
    plannerApi: `http://127.0.0.1:${process.env['CORE_PORT'] ?? 4000}`,
    plannerWeb: '/?tab=paineis',
    brainDb: process.env['MCB_DB_PATH'] ?? path.join(data, 'brain', 'brain.db'),
    brainWeb: '/?tab=pesquisa',
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function readPlanner(p: IntegrationPaths, now: number): Promise<HojeSnapshot['planner']> {
  const out: HojeSnapshot['planner'] = {
    source: 'off',
    webUrl: p.plannerWeb,
    events: [],
    calendarConnected: false,
    tasks: [],
    projects: [],
    clients: [],
    pipelineValue: 0,
    exams: [],
    studyDue: [],
    habits: [],
    papersQueued: 0,
    inboxUnhandled: 0,
  };

  let apiUp = false;
  try {
    await fetchJson(`${p.plannerApi}/health`);
    apiUp = true;
    const cal = (await fetchJson(
      `${p.plannerApi}/integrations/google/calendar?limit=15`,
    )) as unknown;
    const list = Array.isArray(cal) ? cal : [];
    out.calendarConnected = true;
    out.events = list
      .map((e) => e as Row)
      .filter((e) => str(e.title) && str(e.start))
      .map((e) => ({
        title: str(e.title)!,
        start: str(e.start)!,
        ...(str(e.end) ? { end: str(e.end)! } : {}),
        ...(str(e.location) ? { location: str(e.location)! } : {}),
      }))
      .slice(0, 10);
  } catch {
    // Core off, or Google not connected: the database still has the rest.
  }

  let db: Db | null = null;
  try {
    db = p.plannerDb ? openReadOnly(p.plannerDb) : null;
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  if (!db) {
    if (apiUp) out.source = 'api';
    return out;
  }
  out.source = apiUp ? 'api' : 'db';
  try {
    out.tasks = safeAll(
      db,
      `SELECT id, title, due_at FROM tasks WHERE status IN ('pending','in_progress')
       ORDER BY due_at IS NULL, due_at LIMIT 12`,
    ).map((t) => {
      const due = str(t.due_at);
      return {
        id: String(t.id),
        title: String(t.title),
        dueAt: due,
        overdue: !!due && Date.parse(due) < now,
      };
    });
    out.projects = safeAll(
      db,
      'SELECT name, progress, goal FROM projects ORDER BY updated_at DESC LIMIT 8',
    ).map((r) => ({ name: String(r.name), progress: num(r.progress) ?? 0, goal: str(r.goal) }));
    out.clients = safeAll(
      db,
      `SELECT name, stage, value, next_action, next_action_at FROM clients
       WHERE stage != 'closed' ORDER BY next_action_at IS NULL, next_action_at LIMIT 10`,
    ).map((r) => ({
      name: String(r.name),
      stage: String(r.stage ?? 'lead'),
      value: num(r.value),
      nextAction: str(r.next_action),
      nextActionAt: str(r.next_action_at),
    }));
    out.pipelineValue = out.clients.reduce((s, c) => s + (c.value ?? 0), 0);
    out.exams = safeAll(db, 'SELECT name, exam_date FROM subjects WHERE exam_date IS NOT NULL')
      .map((r) => {
        const date = String(r.exam_date);
        return {
          subject: String(r.name),
          examDate: date,
          daysLeft: Math.ceil((Date.parse(date) - now) / DAY_MS),
        };
      })
      .filter((e) => Number.isFinite(e.daysLeft) && e.daysLeft >= 0 && e.daysLeft <= 60)
      .sort((a, b) => a.daysLeft - b.daysLeft);
    const horizon = new Date(now + UPCOMING_DAYS * DAY_MS).toISOString();
    out.studyDue = safeAll(
      db,
      'SELECT title, due_at FROM study_topics WHERE done = 0 AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at LIMIT 8',
      horizon,
    ).map((r) => ({ title: String(r.title), dueAt: String(r.due_at) }));
    out.habits = safeAll(db, 'SELECT name, current, target, unit FROM habits ORDER BY name').map(
      (r) => ({
        name: String(r.name),
        current: num(r.current) ?? 0,
        target: num(r.target),
        unit: String(r.unit ?? ''),
      }),
    );
    out.papersQueued = Number(
      safeAll(db, "SELECT count(*) c FROM papers WHERE status IN ('na_fila','em_leitura')")[0]?.c ??
        0,
    );
    out.inboxUnhandled = Number(
      safeAll(db, 'SELECT count(*) c FROM messages WHERE handled = 0')[0]?.c ?? 0,
    );
  } finally {
    db.close();
  }
  return out;
}

const PRIORITY_ORDER =
  "CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END";

function readBrain(p: IntegrationPaths): HojeSnapshot['brain'] {
  const out: HojeSnapshot['brain'] = {
    source: 'off',
    webUrl: p.brainWeb,
    brief: null,
    top: [],
    pending: 0,
    unreadRelevant: 0,
    learning: [],
    builds: [],
  };
  let db: Db | null = null;
  try {
    db = p.brainDb ? openReadOnly(p.brainDb) : null;
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  if (!db) return out;
  out.source = 'db';
  try {
    const b = safeAll(
      db,
      'SELECT date, headline, intro, next_move FROM briefs ORDER BY date DESC, created_at DESC LIMIT 1',
    )[0];
    if (b) {
      const move = parseJson<{ title?: string; action?: string } | null>(b.next_move, null);
      out.brief = {
        date: String(b.date),
        headline: String(b.headline ?? '').replace(/\\n/g, '\n'),
        intro: str(b.intro),
        nextMove: move?.title ? { title: move.title, action: move.action ?? '' } : null,
      };
    }
    out.top = safeAll(
      db,
      `SELECT id, title, priority, why_it_matters, url FROM contents
       WHERE status = 'analyzed' AND user_state = 'UNREAD' AND priority IN ('P0','P1','P2')
       ORDER BY ${PRIORITY_ORDER}, analyzed_at DESC LIMIT 8`,
    ).map((r) => ({
      id: String(r.id),
      title: String(r.title),
      priority: String(r.priority),
      why: String(r.why_it_matters ?? ''),
      url: String(r.url),
    }));
    out.pending = Number(
      safeAll(db, "SELECT count(*) c FROM contents WHERE status = 'pending'")[0]?.c ?? 0,
    );
    out.unreadRelevant = Number(
      safeAll(
        db,
        "SELECT count(*) c FROM contents WHERE status = 'analyzed' AND user_state = 'UNREAD' AND priority IN ('P0','P1')",
      )[0]?.c ?? 0,
    );
    out.learning = safeAll(
      db,
      'SELECT title, track, progress FROM learning_items WHERE progress < 100 ORDER BY updated_at DESC LIMIT 6',
    ).map((r) => ({ title: String(r.title), track: str(r.track), progress: num(r.progress) ?? 0 }));
    out.builds = safeAll(
      db,
      "SELECT name, status, tasks FROM projects WHERE status IN ('IDEA','PLANNED','BUILDING','PAUSED') AND rejected_at IS NULL ORDER BY created_at DESC LIMIT 6",
    ).map((r) => {
      const tasks = parseJson<Array<{ status?: string }>>(r.tasks, []);
      return {
        name: String(r.name),
        status: String(r.status),
        done: tasks.filter((t) => t.status === 'DONE').length,
        total: tasks.length,
      };
    });
  } finally {
    db.close();
  }
  return out;
}

export async function readHoje(p: IntegrationPaths, now = Date.now()): Promise<HojeSnapshot> {
  const [planner, brain] = await Promise.all([
    readPlanner(p, now).catch((err: unknown) => ({
      ...emptyPlanner(p),
      error: err instanceof Error ? err.message : String(err),
    })),
    Promise.resolve().then(() => readBrain(p)),
  ]);
  return { fetchedAt: now, planner, brain };
}

function emptyPlanner(p: IntegrationPaths): HojeSnapshot['planner'] {
  return {
    source: 'off',
    webUrl: p.plannerWeb,
    events: [],
    calendarConnected: false,
    tasks: [],
    projects: [],
    clients: [],
    pipelineValue: 0,
    exams: [],
    studyDue: [],
    habits: [],
    papersQueued: 0,
    inboxUnhandled: 0,
  };
}
