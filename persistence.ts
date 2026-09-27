import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Brief, BoardPost, BrainSettings, BrainState, ChatEntry, Reminder } from './types.js';

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
};

export function defaultBrainDir(): string {
  return path.join(os.homedir(), '.pixel-agents', 'brain');
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJsonLines<T>(file: string, limit: number): T[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const out: T[] = [];
  for (const line of lines.slice(-limit)) {
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
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'state.json'), 'utf8')) as Partial<BrainState>;
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

  appendChat(entry: ChatEntry): void {
    fs.appendFileSync(this.chatFile(entry.agent), JSON.stringify(entry) + '\n');
  }

  readChat(agentKey: string, limit = 200): ChatEntry[] {
    return readJsonLines<ChatEntry>(this.chatFile(agentKey), limit);
  }

  appendBoard(post: BoardPost): void {
    fs.appendFileSync(path.join(this.dir, 'board.jsonl'), JSON.stringify(post) + '\n');
  }

  readBoard(limit = 200): BoardPost[] {
    return readJsonLines<BoardPost>(path.join(this.dir, 'board.jsonl'), limit);
  }

  loadReminders(): Reminder[] {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'reminders.json'), 'utf8')) as unknown;
      return Array.isArray(raw) ? (raw as Reminder[]) : [];
    } catch {
      return [];
    }
  }

  saveReminders(reminders: Reminder[]): void {
    writeAtomic(path.join(this.dir, 'reminders.json'), JSON.stringify(reminders, null, 2));
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
