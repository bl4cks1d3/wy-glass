import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { IntegrationPaths } from './integrations.js';

/** Local, token-free data access for the office tabs: Planner Life and
 *  My Current Brain read AND written straight from their SQLite files (plus
 *  the Planner vault on disk). Writes mirror what each app's own code does,
 *  so either app keeps working on the same data. No agent is involved. */

type Row = Record<string, unknown>;
interface Stmt {
  all(...params: unknown[]): Row[];
  get(...params: unknown[]): Row | undefined;
  run(...params: unknown[]): { changes: number | bigint };
}
interface Db {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  close(): void;
}

export class LocalDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

function open(file: string | null, write: boolean): Db {
  if (!file || !fs.existsSync(file)) throw new LocalDataError('banco não encontrado', 503);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (f: string, o: { readOnly: boolean }) => Db;
  };
  const db = new DatabaseSync(file, { readOnly: !write });
  // The other app may hold a write lock for a moment: wait instead of failing.
  db.exec('PRAGMA busy_timeout = 3000');
  return db;
}

function use<T>(file: string | null, write: boolean, fn: (db: Db) => T): T {
  const db = open(file, write);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function all(db: Db, sql: string, ...params: unknown[]): Row[] {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return []; // table or column absent in this version of the other app
  }
}

function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function text(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function requireText(v: unknown, field: string, max = 500): string {
  const t = text(v, max);
  if (!t) throw new LocalDataError(`${field} é obrigatório`);
  return t;
}

function isoOrNull(v: unknown): string | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)))
    throw new LocalDataError('data inválida');
  return new Date(v).toISOString();
}

function checkChanged(r: { changes: number | bigint }): void {
  if (Number(r.changes) === 0) throw new LocalDataError('registro não encontrado', 404);
}

const TASK_STATUSES = new Set(['pending', 'in_progress', 'done', 'cancelled']);
const CLIENT_STAGES = new Set(['lead', 'contact', 'proposal', 'closed']);
const USER_STATES = new Set(['UNREAD', 'READ', 'SAVED', 'LEARNING', 'COMPLETED', 'IGNORED']);
const FEEDBACK = new Set(['useful', 'not_useful', 'not_for_me', 'very_relevant', 'later']);
const MILESTONE_STATES = new Set(['todo', 'known', 'studying', 'skipped']);
const PROJECT_STATES = new Set(['IDEA', 'PLANNED', 'BUILDING', 'PAUSED', 'COMPLETED', 'ARCHIVED']);

export interface LocalPaths extends IntegrationPaths {
  vaultDir: string | null;
}

export function resolveVaultDir(plannerDb: string | null): string | null {
  const configured = process.env['OBSIDIAN_VAULT_PATH']?.trim();
  if (configured) return configured;
  if (!plannerDb) return null;
  // Same default as the Planner Core: data/planner/vault next to planner.db.
  return path.join(path.dirname(plannerDb), 'vault');
}

export class LocalData {
  constructor(private readonly p: LocalPaths) {}

  // ── Planner Life: reads ──────────────────────────────────────

  plannerAll(): Record<string, unknown> {
    return use(this.p.plannerDb, false, (db) => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      return {
        tasks: all(
          db,
          'SELECT * FROM tasks ORDER BY due_at IS NULL, due_at, created_at DESC LIMIT 400',
        ),
        projects: all(db, 'SELECT * FROM projects ORDER BY updated_at DESC'),
        clients: all(db, 'SELECT * FROM clients ORDER BY updated_at DESC'),
        subjects: all(db, 'SELECT * FROM subjects ORDER BY name'),
        topics: all(db, 'SELECT * FROM study_topics ORDER BY done, due_at IS NULL, due_at'),
        schedule: all(db, 'SELECT * FROM schedule_blocks ORDER BY day_of_week, start_time'),
        sessions: all(
          db,
          'SELECT * FROM study_sessions WHERE started_at >= ? ORDER BY started_at DESC',
          since,
        ),
        habits: all(db, 'SELECT * FROM habits ORDER BY name'),
        papers: all(db, 'SELECT * FROM papers ORDER BY updated_at DESC'),
        researchLines: all(db, 'SELECT * FROM research_lines ORDER BY updated_at DESC'),
        messages: all(db, 'SELECT * FROM messages ORDER BY received_at DESC LIMIT 100'),
        memory: all(db, 'SELECT * FROM memory_entries ORDER BY created_at DESC LIMIT 200'),
        automations: all(
          db,
          'SELECT id, name, description, active, source, last_run_at, last_status FROM automations ORDER BY name',
        ),
        blocks: all(
          db,
          'SELECT id, name, description, source, approved, updated_at FROM blocks ORDER BY name',
        ),
        collections: all(
          db,
          'SELECT id, name, label, description, fields FROM collections ORDER BY label',
        ).map((c) => ({
          ...c,
          fields: json(c.fields, []),
        })),
      };
    });
  }

  records(collection: string): Row[] {
    return use(this.p.plannerDb, false, (db) =>
      all(
        db,
        `SELECT r.id, r.data, r.created_at, r.updated_at FROM records r
         JOIN collections c ON c.id = r.collection_id WHERE c.name = ? ORDER BY r.created_at DESC LIMIT 500`,
        collection,
      ).map((r) => ({ ...r, data: json(r.data, {}) })),
    );
  }

  // ── Planner Life: writes ─────────────────────────────────────

  plannerWrite(
    entity: string,
    action: 'create' | 'update' | 'delete',
    id: string | null,
    body: Row,
  ): Row {
    return use(this.p.plannerDb, true, (db) => {
      const t = now();
      switch (`${entity}:${action}`) {
        case 'tasks:create': {
          const row = {
            id: randomUUID(),
            title: requireText(body.title, 'título'),
            project_id: text(body.projectId, 80),
            status: 'pending',
            due_at: isoOrNull(body.dueAt ?? null),
            notes: text(body.notes),
          };
          db.prepare(
            'INSERT INTO tasks (id, title, project_id, status, due_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(row.id, row.title, row.project_id, row.status, row.due_at, row.notes, t, t);
          return row;
        }
        case 'tasks:update': {
          const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
          if (!cur) throw new LocalDataError('tarefa não encontrada', 404);
          const status = body.status === undefined ? cur.status : String(body.status);
          if (!TASK_STATUSES.has(String(status))) throw new LocalDataError('status inválido');
          const title = body.title === undefined ? cur.title : requireText(body.title, 'título');
          const due = body.dueAt === undefined ? cur.due_at : isoOrNull(body.dueAt);
          db.prepare(
            'UPDATE tasks SET title = ?, status = ?, due_at = ?, updated_at = ? WHERE id = ?',
          ).run(title, status, due, t, id);
          return { id, title, status, due_at: due };
        }
        case 'tasks:delete':
          checkChanged(db.prepare('DELETE FROM tasks WHERE id = ?').run(id));
          return { id };
        case 'projects:create': {
          const row = {
            id: randomUUID(),
            name: requireText(body.name, 'nome'),
            goal: text(body.goal),
          };
          db.prepare(
            'INSERT INTO projects (id, name, goal, progress, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
          ).run(row.id, row.name, row.goal, t, t);
          return row;
        }
        case 'projects:update': {
          const progress = Math.max(0, Math.min(100, Math.round(Number(body.progress))));
          if (!Number.isFinite(progress)) throw new LocalDataError('progresso inválido');
          checkChanged(
            db
              .prepare('UPDATE projects SET progress = ?, updated_at = ? WHERE id = ?')
              .run(progress, t, id),
          );
          return { id, progress };
        }
        case 'clients:create': {
          const row = {
            id: randomUUID(),
            name: requireText(body.name, 'nome'),
            stage: CLIENT_STAGES.has(String(body.stage)) ? String(body.stage) : 'lead',
            value: Number(body.value) || 0,
            next_action: text(body.nextAction, 200),
            next_action_at: isoOrNull(body.nextActionAt ?? null),
          };
          db.prepare(
            'INSERT INTO clients (id, name, stage, value, next_action, next_action_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(row.id, row.name, row.stage, row.value, row.next_action, row.next_action_at, t, t);
          return row;
        }
        case 'clients:update': {
          const cur = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
          if (!cur) throw new LocalDataError('cliente não encontrado', 404);
          const stage = body.stage === undefined ? cur.stage : String(body.stage);
          if (!CLIENT_STAGES.has(String(stage))) throw new LocalDataError('etapa inválida');
          const nextAction =
            body.nextAction === undefined ? cur.next_action : text(body.nextAction, 200);
          const nextAt =
            body.nextActionAt === undefined ? cur.next_action_at : isoOrNull(body.nextActionAt);
          const value = body.value === undefined ? cur.value : Number(body.value) || 0;
          db.prepare(
            'UPDATE clients SET stage = ?, next_action = ?, next_action_at = ?, value = ?, updated_at = ? WHERE id = ?',
          ).run(stage, nextAction, nextAt, value, t, id);
          return { id, stage, next_action: nextAction, next_action_at: nextAt, value };
        }
        case 'subjects:create': {
          const row = {
            id: randomUUID(),
            name: requireText(body.name, 'nome'),
            exam_date: isoOrNull(body.examDate ?? null),
          };
          db.prepare(
            'INSERT INTO subjects (id, name, progress, note, exam_date, created_at, updated_at) VALUES (?, ?, 0, NULL, ?, ?, ?)',
          ).run(row.id, row.name, row.exam_date, t, t);
          return row;
        }
        case 'subjects:update': {
          const exam = isoOrNull(body.examDate ?? null);
          checkChanged(
            db
              .prepare('UPDATE subjects SET exam_date = ?, updated_at = ? WHERE id = ?')
              .run(exam, t, id),
          );
          return { id, exam_date: exam };
        }
        case 'topics:create': {
          const subjectId = requireText(body.subjectId, 'disciplina', 80);
          const row = {
            id: randomUUID(),
            subject_id: subjectId,
            title: requireText(body.title, 'título'),
            due_at: isoOrNull(body.dueAt ?? null),
          };
          db.prepare(
            'INSERT INTO study_topics (id, subject_id, title, done, due_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
          ).run(row.id, row.subject_id, row.title, row.due_at, t, t);
          this.recalcSubject(db, subjectId);
          return row;
        }
        case 'topics:update': {
          const cur = db.prepare('SELECT subject_id FROM study_topics WHERE id = ?').get(id);
          if (!cur) throw new LocalDataError('tópico não encontrado', 404);
          const done = body.done ? 1 : 0;
          db.prepare('UPDATE study_topics SET done = ?, updated_at = ? WHERE id = ?').run(
            done,
            t,
            id,
          );
          this.recalcSubject(db, String(cur.subject_id));
          return { id, done };
        }
        case 'sessions:create': {
          const minutes = Math.round(Number(body.minutes));
          if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600)
            throw new LocalDataError('duração inválida');
          const ended = new Date();
          const started = new Date(ended.getTime() - minutes * 60_000);
          const row = {
            id: randomUUID(),
            subject_id: text(body.subjectId, 80),
            duration_minutes: minutes,
          };
          db.prepare(
            'INSERT INTO study_sessions (id, subject_id, duration_minutes, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          ).run(row.id, row.subject_id, minutes, started.toISOString(), ended.toISOString(), t);
          return row;
        }
        case 'habits:create': {
          const row = {
            id: randomUUID(),
            name: requireText(body.name, 'nome'),
            unit: text(body.unit, 30) ?? '',
            target: Number(body.target) || 0,
          };
          db.prepare(
            'INSERT INTO habits (id, name, unit, target, current, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
          ).run(row.id, row.name, row.unit, row.target, t, t);
          return row;
        }
        case 'habits:update': {
          const cur = db.prepare('SELECT current FROM habits WHERE id = ?').get(id);
          if (!cur) throw new LocalDataError('hábito não encontrado', 404);
          const next =
            body.reset === true
              ? 0
              : Math.max(0, Number(cur.current ?? 0) + (Number(body.delta) || 0));
          db.prepare('UPDATE habits SET current = ?, updated_at = ? WHERE id = ?').run(next, t, id);
          return { id, current: next };
        }
        case 'habits:delete':
          checkChanged(db.prepare('DELETE FROM habits WHERE id = ?').run(id));
          return { id };
        case 'messages:update':
          checkChanged(
            db
              .prepare('UPDATE messages SET handled = ? WHERE id = ?')
              .run(body.handled ? 1 : 0, id),
          );
          return { id };
        case 'memory:update': {
          const content = requireText(body.content, 'conteúdo', 4000);
          checkChanged(
            db.prepare('UPDATE memory_entries SET content = ? WHERE id = ?').run(content, id),
          );
          return { id, content };
        }
        case 'memory:delete':
          checkChanged(db.prepare('DELETE FROM memory_entries WHERE id = ?').run(id));
          return { id };
        case 'papers:update': {
          const status = String(body.status);
          if (!['na_fila', 'em_leitura', 'resumido'].includes(status))
            throw new LocalDataError('status inválido');
          checkChanged(
            db
              .prepare('UPDATE papers SET status = ?, updated_at = ? WHERE id = ?')
              .run(status, t, id),
          );
          return { id, status };
        }
        default:
          throw new LocalDataError(`operação desconhecida: ${entity}:${action}`, 404);
      }
    });
  }

  /** Subject progress = share of its topics that are done (Planner Life's rule). */
  private recalcSubject(db: Db, subjectId: string): void {
    const r = db
      .prepare('SELECT count(*) AS n, sum(done) AS d FROM study_topics WHERE subject_id = ?')
      .get(subjectId);
    const n = Number(r?.n ?? 0);
    const progress = n ? Math.round((Number(r?.d ?? 0) / n) * 100) : 0;
    db.prepare('UPDATE subjects SET progress = ?, updated_at = ? WHERE id = ?').run(
      progress,
      now(),
      subjectId,
    );
  }

  /** Records in a named collection, creating it with `fields` on first use. */
  recordWrite(
    collection: string,
    action: 'create' | 'update' | 'delete',
    id: string | null,
    body: Row,
    create?: { label: string; fields: Array<{ name: string; type: string }> },
  ): Row {
    if (!/^[a-z0-9_]{2,40}$/.test(collection)) throw new LocalDataError('coleção inválida');
    return use(this.p.plannerDb, true, (db) => {
      const t = now();
      let col = db.prepare('SELECT id FROM collections WHERE name = ?').get(collection);
      if (!col) {
        if (!create || action !== 'create') throw new LocalDataError('coleção não encontrada', 404);
        const cid = randomUUID();
        db.prepare(
          'INSERT INTO collections (id, name, label, description, fields, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        ).run(cid, collection, create.label, JSON.stringify(create.fields), t, t);
        col = { id: cid };
      }
      const data =
        body.data && typeof body.data === 'object'
          ? JSON.stringify(body.data).slice(0, 20_000)
          : '{}';
      if (action === 'create') {
        const rid = randomUUID();
        db.prepare(
          'INSERT INTO records (id, collection_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run(rid, col.id, data, t, t);
        return { id: rid };
      }
      if (action === 'update') {
        checkChanged(
          db
            .prepare(
              'UPDATE records SET data = ?, updated_at = ? WHERE id = ? AND collection_id = ?',
            )
            .run(data, t, id, col.id),
        );
        return { id };
      }
      checkChanged(
        db.prepare('DELETE FROM records WHERE id = ? AND collection_id = ?').run(id, col.id),
      );
      return { id };
    });
  }

  // ── Vault (Planner Life notes) ───────────────────────────────

  private vaultPath(rel: string): string {
    const root = this.p.vaultDir;
    if (!root) throw new LocalDataError('vault não encontrado', 503);
    const clean = rel.replace(/^[/\\]+/, '');
    if (!clean.toLowerCase().endsWith('.md')) throw new LocalDataError('só arquivos .md');
    const full = path.resolve(root, clean);
    const rootSep = path.resolve(root) + path.sep;
    if (!full.startsWith(rootSep)) throw new LocalDataError('caminho fora do vault');
    return full;
  }

  listNotes(): Array<{ path: string; title: string; updatedAt: string }> {
    const root = this.p.vaultDir;
    if (!root || !fs.existsSync(root)) return [];
    const out: Array<{ path: string; title: string; updatedAt: string }> = [];
    const walk = (dir: string, base: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const rel = base ? `${base}/${e.name}` : e.name;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, rel);
        else if (e.name.toLowerCase().endsWith('.md')) {
          out.push({
            path: rel,
            title: e.name.replace(/\.md$/i, ''),
            updatedAt: fs.statSync(full).mtime.toISOString(),
          });
        }
      }
    };
    walk(root, '');
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 1000);
  }

  readNote(rel: string): { path: string; content: string } {
    const full = this.vaultPath(rel);
    if (!fs.existsSync(full)) throw new LocalDataError('nota não encontrada', 404);
    return { path: rel, content: fs.readFileSync(full, 'utf8') };
  }

  writeNote(rel: string, content: unknown): { path: string } {
    if (typeof content !== 'string' || content.length > 500_000)
      throw new LocalDataError('conteúdo inválido');
    const full = this.vaultPath(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return { path: rel };
  }

  // ── My Current Brain: reads ──────────────────────────────────

  brainView(view: string, q: Record<string, string | undefined>): unknown {
    return use(this.p.brainDb, false, (db) => {
      switch (view) {
        case 'now': {
          const pr = (q.priority ?? 'P0,P1').split(',').filter((x) => /^P[0-3]$/.test(x));
          const states = q.state === 'all' ? null : (q.state ?? 'UNREAD');
          const params: unknown[] = [...pr];
          let sql = `SELECT id, title, url, author, priority, area, category, summary, why_it_matters, key_points,
                     read_minutes, user_state, feedback, published_at, analyzed_at, tags
                     FROM contents WHERE status = 'analyzed' AND priority IN (${pr.map(() => '?').join(',') || "''"})`;
          if (states) {
            sql += ' AND user_state = ?';
            params.push(states);
          }
          sql +=
            " ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, analyzed_at DESC LIMIT 60";
          return all(db, sql, ...params).map((r) => ({
            ...r,
            key_points: json(r.key_points, []),
            tags: json(r.tags, []),
          }));
        }
        case 'brief': {
          const b = all(db, 'SELECT * FROM briefs ORDER BY date DESC, created_at DESC LIMIT 1')[0];
          return b
            ? {
                ...b,
                blocks: json(b.blocks, []),
                next_move: json(b.next_move, null),
                stats: json(b.stats, {}),
              }
            : null;
        }
        case 'learn':
          return all(
            db,
            'SELECT id, title, track, why, steps_done, progress, minutes_total, updated_at, steps FROM learning_items ORDER BY progress >= 100, updated_at DESC',
          ).map((r) => {
            const steps = json<Array<Record<string, unknown>>>(r.steps, []);
            return { ...r, steps: undefined, stepCount: steps.length };
          });
        case 'lesson': {
          const r = all(db, 'SELECT * FROM learning_items WHERE id = ?', q.id ?? '')[0];
          if (!r) throw new LocalDataError('aula não encontrada', 404);
          return { ...r, steps: json(r.steps, []), sources: json(r.sources, []) };
        }
        case 'build':
          return all(
            db,
            'SELECT * FROM projects WHERE rejected_at IS NULL ORDER BY created_at DESC',
          ).map((r) => ({
            ...r,
            tasks: json(r.tasks, []),
            technologies: json(r.technologies, []),
          }));
        case 'watch':
          return all(db, 'SELECT * FROM build_watch ORDER BY happened_at DESC LIMIT 60').map(
            (r) => ({
              ...r,
              changes: json(r.changes, []),
              technologies: json(r.technologies, []),
            }),
          );
        case 'frontier':
          return all(
            db,
            `SELECT id, title, url, priority, summary, why_it_matters, read_minutes, user_state FROM contents
             WHERE status = 'analyzed' AND (area = 'frontier' OR category = 'RESEARCH' OR category = 'EARLY_STAGE')
             ORDER BY analyzed_at DESC LIMIT 60`,
          );
        case 'people':
          return all(
            db,
            `SELECT c.id, c.name, c.bio, c.status, c.topics,
               (SELECT max(published_at) FROM contents WHERE creator_id = c.id) AS last_post,
               (SELECT count(*) FROM contents WHERE creator_id = c.id AND published_at >= ?) AS posts7d
             FROM creators c ORDER BY last_post DESC`,
            new Date(Date.now() - 7 * 86_400_000).toISOString(),
          ).map((r) => ({ ...r, topics: json(r.topics, []) }));
        case 'trending':
          return all(
            db,
            `SELECT full_name, url, description, language, stars, trending_gain, trending_period, why_it_matters
             FROM repos WHERE trending_at IS NOT NULL ORDER BY trending_at DESC, trending_gain DESC LIMIT 60`,
          );
        case 'catchup':
          return all(db, 'SELECT * FROM milestones ORDER BY happened_at DESC LIMIT 200').map(
            (r) => ({
              ...r,
              links: json(r.links, []),
            }),
          );
        case 'knowledge':
          return all(
            db,
            'SELECT id, name, domain, description, status, confidence, gap_reason, next_step, last_reviewed FROM knowledge ORDER BY domain, name',
          );
        case 'sources':
          return all(
            db,
            `SELECT s.id, s.kind, s.name, s.url, s.enabled, s.last_fetched_at, s.last_error,
               (SELECT count(*) FROM contents c WHERE c.source_id = s.id) AS items,
               (SELECT count(*) FROM contents c WHERE c.source_id = s.id AND c.status = 'analyzed' AND c.priority IN ('P0','P1','P2')) AS relevant
             FROM sources s ORDER BY relevant DESC, items DESC`,
          );
        default:
          throw new LocalDataError(`visão desconhecida: ${view}`, 404);
      }
    });
  }

  // ── My Current Brain: writes ─────────────────────────────────

  brainWrite(kind: string, id: string, body: Row): Row {
    return use(this.p.brainDb, true, (db) => {
      switch (kind) {
        case 'state': {
          const state = String(body.state);
          if (!USER_STATES.has(state)) throw new LocalDataError('estado inválido');
          checkChanged(
            db.prepare('UPDATE contents SET user_state = ? WHERE id = ?').run(state, id),
          );
          return { id, state };
        }
        case 'feedback': {
          const signal = String(body.signal);
          if (!FEEDBACK.has(signal)) throw new LocalDataError('sinal inválido');
          db.prepare('INSERT INTO feedback (content_id, signal, created_at) VALUES (?, ?, ?)').run(
            id,
            signal,
            now(),
          );
          checkChanged(db.prepare('UPDATE contents SET feedback = ? WHERE id = ?').run(signal, id));
          return { id, signal };
        }
        case 'step': {
          // Mirrors currentBrain's completeLearningStep: progress never goes backwards.
          const r = db
            .prepare('SELECT steps, steps_done, progress FROM learning_items WHERE id = ?')
            .get(id);
          if (!r) throw new LocalDataError('aula não encontrada', 404);
          const steps = json<unknown[]>(r.steps, []);
          const index = Number(body.index);
          if (!Number.isInteger(index) || index < 0 || index >= steps.length)
            throw new LocalDataError('etapa inválida');
          const stepsDone = Math.max(Number(r.steps_done ?? 0), index + 1);
          const progress = Math.max(
            Number(r.progress ?? 0),
            Math.round((stepsDone / steps.length) * 100),
          );
          db.prepare(
            'UPDATE learning_items SET steps_done = ?, progress = ?, updated_at = ? WHERE id = ?',
          ).run(stepsDone, progress, now(), id);
          return { id, stepsDone, progress };
        }
        case 'milestone': {
          const state = String(body.state);
          if (!MILESTONE_STATES.has(state)) throw new LocalDataError('estado inválido');
          checkChanged(db.prepare('UPDATE milestones SET state = ? WHERE id = ?').run(state, id));
          return { id, state };
        }
        case 'project': {
          // currentBrain marks a rejection by date and keeps the status as is.
          if (body.reject === true) {
            checkChanged(
              db.prepare('UPDATE projects SET rejected_at = ? WHERE id = ?').run(now(), id),
            );
            return { id, rejected: true };
          }
          const status = String(body.status);
          if (!PROJECT_STATES.has(status)) throw new LocalDataError('status inválido');
          const done = status === 'COMPLETED' ? now() : null;
          checkChanged(
            db
              .prepare(
                'UPDATE projects SET status = ?, completed_at = coalesce(?, completed_at) WHERE id = ?',
              )
              .run(status, done, id),
          );
          return { id, status };
        }
        default:
          throw new LocalDataError(`operação desconhecida: ${kind}`, 404);
      }
    });
  }
}
