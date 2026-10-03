import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  default_area TEXT,
  every_minutes INTEGER NOT NULL DEFAULT 60,
  origin TEXT NOT NULL DEFAULT 'default',
  topic TEXT,
  platform TEXT,
  creator_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS contents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  excerpt TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  duplicate_of TEXT,
  area TEXT,
  category TEXT,
  summary TEXT,
  why_it_matters TEXT,
  key_points TEXT NOT NULL DEFAULT '[]',
  explain TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  priority TEXT,
  read_minutes INTEGER,
  related_knowledge TEXT NOT NULL DEFAULT '[]',
  learn_topic TEXT,
  maturity INTEGER,
  signals TEXT,
  analyzed_at TEXT,
  user_state TEXT NOT NULL DEFAULT 'UNREAD',
  feedback TEXT,
  backfill INTEGER NOT NULL DEFAULT 0,
  creator_id TEXT,
  UNIQUE (source_id, external_id)
);
CREATE INDEX IF NOT EXISTS contents_status ON contents (status);
CREATE INDEX IF NOT EXISTS contents_area ON contents (area, priority);
CREATE INDEX IF NOT EXISTS contents_url ON contents (url);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL,
  signal TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT,
  domain TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  related TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '[]',
  next_step TEXT,
  gap_reason TEXT,
  pos TEXT,
  created_at TEXT NOT NULL,
  last_reviewed TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL,
  difficulty TEXT,
  estimated_time TEXT,
  technologies TEXT NOT NULL DEFAULT '[]',
  prerequisites TEXT NOT NULL DEFAULT '[]',
  tasks TEXT NOT NULL DEFAULT '[]',
  ai_suggested INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  source_content_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS learning_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  track TEXT,
  why TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  steps_done INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  minutes_total INTEGER NOT NULL DEFAULT 15,
  source_content_id TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  written_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_paths (
  id TEXT PRIMARY KEY,
  goal_id TEXT,
  name TEXT NOT NULL,
  goal TEXT,
  modules TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'following',
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  full_name TEXT PRIMARY KEY COLLATE NOCASE,
  url TEXT NOT NULL,
  description TEXT,
  language TEXT,
  topics TEXT NOT NULL DEFAULT '[]',
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  pushed_at TEXT,
  first_seen TEXT NOT NULL,
  refreshed_at TEXT,
  why_it_matters TEXT,
  via TEXT,
  trending_gain INTEGER,
  trending_period TEXT,
  trending_at TEXT
);

CREATE TABLE IF NOT EXISTS repo_snapshots (
  full_name TEXT NOT NULL COLLATE NOCASE,
  day TEXT NOT NULL,
  stars INTEGER NOT NULL,
  PRIMARY KEY (full_name, day)
);

CREATE TABLE IF NOT EXISTS repo_mentions (
  full_name TEXT NOT NULL COLLATE NOCASE,
  content_id TEXT NOT NULL,
  creator_id TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (full_name, content_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  why TEXT,
  importance TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  content_id TEXT,
  state TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT NOT NULL,
  UNIQUE (topic, title)
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  path_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_resources (
  id TEXT PRIMARY KEY,
  goal_id TEXT,
  path_id TEXT,
  module TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  minutes INTEGER,
  level TEXT,
  language TEXT,
  why TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (url, goal_id)
);

CREATE TABLE IF NOT EXISTS build_watch (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  author TEXT,
  url TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '[]',
  technologies TEXT NOT NULL DEFAULT '[]',
  why TEXT,
  happened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefs (
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  headline TEXT NOT NULL,
  intro TEXT,
  item_ids TEXT NOT NULL DEFAULT '[]',
  blocks TEXT NOT NULL DEFAULT '[]',
  next_move TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (date, type)
);

CREATE TABLE IF NOT EXISTS mcp_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  agent TEXT,
  roles TEXT NOT NULL,
  tools_exposed INTEGER NOT NULL,
  schema_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  run_id TEXT,
  tool TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS tool_calls_run ON tool_calls (run_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT,
  stats TEXT NOT NULL DEFAULT '{}'
);
`;

/** Walks up from cwd to the monorepo root (the package.json with "workspaces"). */
function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, 'utf8')).workspaces) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function resolveDbPath(): string {
  // Brain Office layout: the monorepo root keeps every personal data file under data/.
  return process.env.MCB_DB_PATH?.trim() || join(findRepoRoot(), 'data', 'brain', 'brain.db');
}

// Cached on globalThis so Next.js dev reloads don't open a new handle per edit.
// The schema signature travels with it: when a reload brings new tables/columns, the cached
// handle is migrated too (otherwise a long-running `next dev` fails with "no such column").
const g = globalThis as unknown as { __mcbDb?: DatabaseSync; __mcbSchema?: string };
const schemaSignature = () => `${SCHEMA.length}:${COLUMNS.map((c) => c.join('.')).join('|')}`;

export function getDb(): DatabaseSync {
  if (!g.__mcbDb) {
    const path = resolveDbPath();
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    g.__mcbDb = db;
  }
  const sig = schemaSignature();
  if (g.__mcbSchema !== sig) {
    g.__mcbDb.exec(SCHEMA);
    migrate(g.__mcbDb);
    g.__mcbSchema = sig;
  }
  return g.__mcbDb;
}

/** Adds columns introduced after a table was first created (SQLite has no ADD COLUMN IF NOT EXISTS). */
const COLUMNS: [table: string, column: string, ddl: string][] = [
  ['sources', 'origin', "TEXT NOT NULL DEFAULT 'default'"],
  ['sources', 'topic', 'TEXT'],
  ['learning_paths', 'goal_id', 'TEXT'],
  ['contents', 'backfill', 'INTEGER NOT NULL DEFAULT 0'],
  ['contents', 'creator_id', 'TEXT'],
  ['sources', 'platform', 'TEXT'],
  ['sources', 'creator_id', 'TEXT'],
  ['learning_items', 'sources', "TEXT NOT NULL DEFAULT '[]'"],
  ['learning_items', 'written_at', 'TEXT'],
  ['projects', 'rejection', 'TEXT'],
  ['projects', 'rejected_at', 'TEXT'],
  ['repos', 'trending_gain', 'INTEGER'],
  ['repos', 'trending_period', 'TEXT'],
  ['repos', 'trending_at', 'TEXT'],
];

function migrate(db: DatabaseSync) {
  for (const [table, column, ddl] of COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function resetDb(): void {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t.name}`);
  db.exec(SCHEMA);
}
