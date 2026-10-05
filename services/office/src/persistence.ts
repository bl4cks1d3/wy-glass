import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  BoardPost,
  BrainSettings,
  BrainState,
  Brief,
  ChatEntry,
  Reminder,
  RunRecord,
} from './types.js';

/** Resident character ids start here so they never collide with the small ids
 *  the runtime hands out to adopted terminal sessions. */
export const RESIDENT_ID_BASE = 9000;

export const DEFAULT_SETTINGS: BrainSettings = {
  agentsEnabled: true,
  maxConcurrent: 2,
  softGuard: 80,
  hardGuard: 95,
  briefEnabled: true,
  briefTime: '07:30',
  routineModel: 'haiku',
  paceGuard: true,
};

/** A user message still waiting in a queue, kept across restarts. */
export interface PersistedQueueItem {
  id: string;
  agent: string;
  text: string;
  force?: boolean;
  queuedAt: number;
}

export function defaultBrainDir(): string {
  return path.join(os.homedir(), '.pixel-agents', 'brain');
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const TAIL_CHUNK_BYTES = 64 * 1024;
/** A log past this size is moved to archive/, keeping its newest lines. */
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const ROTATE_KEEP_LINES = 500;
const RUNS_KEEP_LINES = 3000;

/** The last `limit` lines, reading backwards from the end so a log that grew
 *  for months costs the same as a new one. */
function readTailLines(file: string, limit: number): string[] {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    let pos = fs.fstatSync(fd).size;
    const chunks: Buffer[] = [];
    let newlines = 0;
    while (pos > 0 && newlines <= limit) {
      const len = Math.min(TAIL_CHUNK_BYTES, pos);
      pos -= len;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      chunks.unshift(buf);
      for (let i = 0; i < len; i++) if (buf[i] === 0x0a) newlines++;
    }
    // Decoded once: a chunk boundary may split a multi-byte character, a
    // newline byte never does.
    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    if (pos > 0) lines.shift(); // partial line
    return lines.filter(Boolean).slice(-limit);
  } finally {
    fs.closeSync(fd);
  }
}

function readJsonLines<T>(file: string, limit: number): T[] {
  const out: T[] = [];
  for (const line of readTailLines(file, limit)) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // skip a torn line
    }
  }
  return out;
}

export class BrainPersistence {
  private readonly chatsDir: string;
  private readonly briefsDir: string;

  constructor(readonly dir: string = defaultBrainDir()) {
    this.chatsDir = path.join(dir, 'chats');
    this.briefsDir = path.join(dir, 'briefs');
    fs.mkdirSync(this.chatsDir, { recursive: true });
    fs.mkdirSync(this.briefsDir, { recursive: true });
  }

  /** Persistent secret for the brain API, so a bookmarked panel URL survives
   *  server restarts (the office token is regenerated on every start). */
  loadOrCreateToken(): string {
    const file = path.join(this.dir, 'token');
    try {
      const t = fs.readFileSync(file, 'utf8').trim();
      if (t.length >= 32) return t;
    } catch {
      // create below
    }
    const token = crypto.randomBytes(24).toString('hex');
    writeAtomic(file, token);
    return token;
  }

  loadState(): BrainState {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.dir, 'state.json'), 'utf8'),
      ) as Partial<BrainState>;
      return {
        agents: raw.agents ?? {},
        nextResidentId: Math.max(raw.nextResidentId ?? RESIDENT_ID_BASE, RESIDENT_ID_BASE),
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
      };
    } catch {
      return { agents: {}, nextResidentId: RESIDENT_ID_BASE, settings: { ...DEFAULT_SETTINGS } };
    }
  }

  saveState(state: BrainState): void {
    writeAtomic(path.join(this.dir, 'state.json'), JSON.stringify(state, null, 2));
  }

  private chatFile(agentKey: string): string {
    return path.join(this.chatsDir, `${agentKey.replace(/[^\w.-]/g, '_')}.jsonl`);
  }

  /** Append one record; a log past MAX_LOG_BYTES first moves to archive/ and
   *  restarts with its newest lines, so readers never see it empty. */
  private appendLog(file: string, record: unknown, keepLines = ROTATE_KEEP_LINES): void {
    try {
      if (fs.statSync(file).size >= MAX_LOG_BYTES) {
        const keep = readTailLines(file, keepLines);
        // Long lines could carry the kept tail past the limit and rotate on
        // every append: keep at most half of it.
        let bytes = keep.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
        while (keep.length > 0 && bytes > MAX_LOG_BYTES / 2) {
          bytes -= Buffer.byteLength(keep.shift()!) + 1;
        }
        const archive = path.join(this.dir, 'archive');
        fs.mkdirSync(archive, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        fs.renameSync(file, path.join(archive, `${path.basename(file, '.jsonl')}.${stamp}.jsonl`));
        writeAtomic(file, keep.map((l) => l + '\n').join(''));
      }
    } catch {
      // missing file, or rotation failed: append below either way
    }
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
  }

  appendChat(entry: ChatEntry): void {
    this.appendLog(this.chatFile(entry.agent), entry);
  }

  readChat(agentKey: string, limit = 200): ChatEntry[] {
    return readJsonLines<ChatEntry>(this.chatFile(agentKey), limit);
  }

  appendBoard(post: BoardPost): void {
    this.appendLog(path.join(this.dir, 'board.jsonl'), post);
  }

  appendRun(record: RunRecord): void {
    this.appendLog(path.join(this.dir, 'runs.jsonl'), record, RUNS_KEEP_LINES);
  }

  /** Runs finished at or after `since` (ms epoch). */
  readRuns(since: number): RunRecord[] {
    return readJsonLines<RunRecord>(path.join(this.dir, 'runs.jsonl'), RUNS_KEEP_LINES).filter(
      (r) => r.ts >= since,
    );
  }

  readBoard(limit = 200): BoardPost[] {
    return readJsonLines<BoardPost>(path.join(this.dir, 'board.jsonl'), limit);
  }

  /** Empty the board. Nothing is lost: the current posts move to archive/. */
  clearBoard(): void {
    const file = path.join(this.dir, 'board.jsonl');
    if (!fs.existsSync(file)) return;
    const archive = path.join(this.dir, 'archive');
    fs.mkdirSync(archive, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.renameSync(file, path.join(archive, `board.limpo.${stamp}.jsonl`));
  }

  /** Remove single posts (the board is small: rewrite it without them). */
  removeBoardPosts(ids: Set<string>): number {
    const file = path.join(this.dir, 'board.jsonl');
    const posts = readJsonLines<BoardPost>(file, Number.MAX_SAFE_INTEGER);
    const kept = posts.filter((p) => !ids.has(p.id));
    if (kept.length === posts.length) return 0;
    writeAtomic(file, kept.map((p) => JSON.stringify(p) + '\n').join(''));
    return posts.length - kept.length;
  }

  /** Widgets pinned on the office canvas (positions in world pixels). */
  loadWidgets(): unknown[] {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.dir, 'widgets.json'), 'utf8'),
      ) as unknown;
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  saveWidgets(widgets: unknown[]): void {
    writeAtomic(path.join(this.dir, 'widgets.json'), JSON.stringify(widgets.slice(0, 60), null, 2));
  }

  loadReminders(): Reminder[] {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.dir, 'reminders.json'), 'utf8'),
      ) as unknown;
      return Array.isArray(raw) ? (raw as Reminder[]) : [];
    } catch {
      return [];
    }
  }

  saveReminders(reminders: Reminder[]): void {
    writeAtomic(path.join(this.dir, 'reminders.json'), JSON.stringify(reminders, null, 2));
  }

  loadQueue(): PersistedQueueItem[] {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'queue.json'), 'utf8')) as unknown;
      return Array.isArray(raw) ? (raw as PersistedQueueItem[]) : [];
    } catch {
      return [];
    }
  }

  saveQueue(items: PersistedQueueItem[]): void {
    writeAtomic(path.join(this.dir, 'queue.json'), JSON.stringify(items, null, 2));
  }

  saveBrief(brief: Brief): void {
    writeAtomic(path.join(this.briefsDir, `${brief.id}.json`), JSON.stringify(brief, null, 2));
  }

  listBriefs(limit = 60): Array<Omit<Brief, 'markdown'>> {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.briefsDir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const out: Array<Omit<Brief, 'markdown'>> = [];
    for (const f of files) {
      try {
        const b = JSON.parse(fs.readFileSync(path.join(this.briefsDir, f), 'utf8')) as Brief;
        out.push({ id: b.id, ts: b.ts, from: b.from, title: b.title });
      } catch {
        // skip unreadable
      }
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  readBrief(id: string): Brief | null {
    if (!/^[\w-]+$/.test(id)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.briefsDir, `${id}.json`), 'utf8')) as Brief;
    } catch {
      return null;
    }
  }
}
