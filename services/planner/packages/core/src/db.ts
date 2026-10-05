import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Automacoes (grafo estilo n8n). Recriadas na migracao se vierem do formato antigo (gatilho + passos), que nunca foi usado.
const AUTOMATION_DDL = `
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  graph TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  active INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  last_run_at TEXT,
  last_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'live',
  trigger_node TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL,
  trigger_payload TEXT NOT NULL DEFAULT '{}',
  nodes TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_runs ON automation_runs(automation_id, started_at);
`;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'pending',
  due_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'lead',
  value REAL NOT NULL DEFAULT 0,
  next_action TEXT,
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  exam_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  day_of_week INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id),
  duration_minutes INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_lines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stage TEXT,
  refs INTEGER NOT NULL DEFAULT 0,
  next_step TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'na_fila',
  research_line_id TEXT REFERENCES research_lines(id),
  note_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT,
  tag TEXT,
  action TEXT,
  handled INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  target REAL NOT NULL DEFAULT 0,
  current REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  html TEXT NOT NULL DEFAULT '',
  css TEXT NOT NULL DEFAULT '',
  js TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '{"read":[],"write":[],"tools":[]}',
  refresh_seconds INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'user',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'grid',
  items TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nodes TEXT NOT NULL DEFAULT '[]',
  viewport TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

${AUTOMATION_DDL}

CREATE TABLE IF NOT EXISTS integration_tokens (
  provider TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT,
  scope TEXT,
  updated_at TEXT NOT NULL
);
`;

/** Colunas adicionadas depois da criacao original da tabela -- `CREATE TABLE
 * IF NOT EXISTS` nao altera uma tabela ja existente, entao um banco criado
 * antes dessas colunas existirem precisa dessa migracao idempotente. */
function migrate(db: DatabaseSync): void {
  const hasColumn = (table: string, column: string): boolean => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((r) => r.name === column);
  };
  if (!hasColumn('papers', 'note_path')) {
    db.exec(`ALTER TABLE papers ADD COLUMN note_path TEXT`);
  }
  if (!hasColumn('subjects', 'exam_date')) {
    db.exec(`ALTER TABLE subjects ADD COLUMN exam_date TEXT`);
  }
  if (!hasColumn('study_topics', 'due_at')) {
    db.exec(`ALTER TABLE study_topics ADD COLUMN due_at TEXT`);
  }
  if (!hasColumn('automations', 'graph')) {
    db.exec(`DROP TABLE IF EXISTS automation_runs; DROP TABLE IF EXISTS automations;`);
    db.exec(AUTOMATION_DDL);
  }
}

export function openDatabase(path: string): DatabaseSync {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export type PlannerDb = DatabaseSync;
