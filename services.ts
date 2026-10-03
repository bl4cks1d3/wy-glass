import { type ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** The Planner Life and My Current Brain back ends, now inside this repo
 *  (services/), started and watched by the Brain Office server so the whole
 *  system is one command. Each keeps its own port on 127.0.0.1; the browser
 *  reaches them only through this server's proxy (/svc/*). */

export interface ServiceStatus {
  id: string;
  label: string;
  enabled: boolean;
  state: 'parado' | 'iniciando' | 'rodando' | 'caiu' | 'desligado';
  port: number | null;
  pid: number | null;
  restarts: number;
  startedAt: number | null;
  lastError: string | null;
  log: string[];
}

interface ServiceDef {
  id: string;
  label: string;
  envFlag: string;
  cwd: string;
  command: string;
  args: string[];
  port: (env: NodeJS.ProcessEnv) => number | null;
  health?: string;
}

const LOG_LINES = 200;
const MAX_BACKOFF_MS = 60_000;

/** KEY=value lines; `#` comments; values may be quoted. No expansion. */
export function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Loads <repo>/.env into process.env (existing variables win). */
/** The office .env with paths made absolute from the repo root (each service
 *  runs in its own folder) and the personal files defaulting to data/. */
export function readOfficeEnv(
  repoDir: string,
  base: NodeJS.ProcessEnv = {},
): Record<string, string> {
  const env: Record<string, string> = { ...parseEnvFile(path.join(repoDir, '.env')) };
  const data = path.join(repoDir, 'data');
  const defaults: Record<string, string> = {
    DB_PATH: path.join(data, 'planner', 'planner.db'),
    OBSIDIAN_VAULT_PATH: path.join(data, 'planner', 'vault'),
    MCB_DB_PATH: path.join(data, 'brain', 'brain.db'),
    CLAUDE_CODE_CWD: repoDir,
  };
  for (const [k, def] of Object.entries(defaults)) {
    const v = (env[k] ?? base[k])?.trim();
    env[k] = !v ? def : path.isAbsolute(v) ? v : path.resolve(repoDir, v);
  }
  // The Planner's settings screen edits this same file.
  env.BRAIN_ENV_PATH = path.join(repoDir, '.env');
  return env;
}

/** Loads the office .env into process.env (variables already set win). */
export function loadOfficeEnv(repoDir: string): void {
  for (const [k, v] of Object.entries(readOfficeEnv(repoDir, process.env))) {
    if (
      process.env[k] === undefined ||
      k in { DB_PATH: 1, OBSIDIAN_VAULT_PATH: 1, MCB_DB_PATH: 1, CLAUDE_CODE_CWD: 1 }
    )
      process.env[k] = v;
  }
}

function defs(repoDir: string): ServiceDef[] {
  const node = process.execPath;
  const planner = (p: string) => path.join(repoDir, 'services', 'planner', 'packages', p);
  const brainDir = path.join(repoDir, 'services', 'brain');
  const num = (v: string | undefined, d: number) => Number(v ?? d) || d;
  return [
    {
      id: 'planner-core',
      label: 'Planner Core (dados, Google, automações)',
      envFlag: 'BRAIN_SVC_PLANNER_CORE',
      cwd: planner('core'),
      command: node,
      args: ['dist/main.js'],
      port: (e) => num(e.CORE_PORT, 4000),
      health: '/health',
    },
    {
      id: 'planner-agent',
      label: 'Planner Agente (chat, rotinas, avisos)',
      envFlag: 'BRAIN_SVC_PLANNER_AGENT',
      cwd: planner('agent'),
      command: node,
      args: ['dist/main.js'],
      port: (e) => num(e.AGENT_PORT, 4100),
      health: '/health',
    },
    {
      id: 'planner-voice',
      label: 'Voz (Piper e Gemini Live)',
      envFlag: 'BRAIN_SVC_PLANNER_VOICE',
      cwd: planner('voice'),
      command: node,
      args: ['dist/main.js'],
      port: (e) => num(e.VOICE_PORT, 4200),
      health: '/health',
    },
    {
      id: 'planner-terminal',
      label: 'Terminais do Planner',
      envFlag: 'BRAIN_SVC_PLANNER_TERMINAL',
      cwd: planner('terminal'),
      command: node,
      args: ['--no-warnings', '--import', 'tsx', 'src/index.ts'],
      port: (e) => num(e.TERMINAL_PORT, 4500),
    },
    {
      id: 'p2p',
      label: 'Nó P2P',
      envFlag: 'BRAIN_SVC_P2P',
      cwd: planner('p2p-node'),
      command: node,
      args: ['--no-warnings', '--import', 'tsx', 'src/cli.ts'],
      port: (e) => num(e.P2P_HTTP_PORT, 4401),
    },
    {
      id: 'brain-worker',
      label: 'Current Brain (coleta, API, terminal)',
      envFlag: 'BRAIN_SVC_BRAIN_WORKER',
      cwd: brainDir,
      command: node,
      args: ['--no-warnings', '--import', 'tsx', 'apps/terminal/src/index.ts'],
      port: (e) => num(e.MCB_TERMINAL_PORT, 3031),
      health: '/health',
    },
  ];
}

interface Running {
  def: ServiceDef;
  child: ChildProcess | null;
  status: ServiceStatus;
  backoff: number;
  timer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
}

export class ServiceSupervisor {
  private readonly services = new Map<string, Running>();
  private onChange: (() => void) | null = null;

  constructor(private readonly repoDir: string) {
    for (const def of defs(repoDir)) {
      this.services.set(def.id, {
        def,
        child: null,
        backoff: 2_000,
        timer: null,
        stopping: false,
        status: {
          id: def.id,
          label: def.label,
          enabled: this.flag(def.envFlag),
          state: 'parado',
          port: def.port(process.env),
          pid: null,
          restarts: 0,
          startedAt: null,
          lastError: null,
          log: [],
        },
      });
    }
  }

  private flag(name: string): boolean {
    return (process.env[name] ?? 'true').toLowerCase() !== 'false';
  }

  setOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  port(id: string): number | null {
    return this.services.get(id)?.status.port ?? null;
  }

  list(): ServiceStatus[] {
    return [...this.services.values()].map((s) => ({ ...s.status, log: s.status.log.slice(-40) }));
  }

  get(id: string): ServiceStatus | undefined {
    const s = this.services.get(id);
    return s ? { ...s.status } : undefined;
  }

  private pidFile(): string {
    return path.join(this.repoDir, 'data', '.services-pids.json');
  }

  private savePids(): void {
    const pids = [...this.services.values()]
      .map((s) => s.child?.pid)
      .filter((p): p is number => typeof p === 'number');
    try {
      fs.mkdirSync(path.dirname(this.pidFile()), { recursive: true });
      fs.writeFileSync(this.pidFile(), JSON.stringify(pids));
    } catch {
      // best effort
    }
  }

  /** Children left running by a previous run that was killed hard (no shutdown
   *  hook) would hold the ports; end them before starting new ones. */
  private reapOrphans(): void {
    let pids: number[] = [];
    try {
      pids = JSON.parse(fs.readFileSync(this.pidFile(), 'utf8')) as number[];
    } catch {
      return;
    }
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
      } catch {
        continue;
      }
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else killTree(pid);
    }
  }

  startAll(): void {
    this.reapOrphans();
    for (const s of this.services.values()) {
      if (s.status.enabled) this.start(s.def.id);
      else s.status.state = 'desligado';
    }
  }

  start(id: string): void {
    const s = this.services.get(id);
    if (!s || s.child) return;
    const entry = path.join(s.def.cwd, s.def.args[s.def.args.length - 1]);
    if (!fs.existsSync(entry)) {
      s.status.state = 'caiu';
      s.status.lastError = `arquivo não encontrado: ${path.relative(this.repoDir, entry)} (rode npm run build)`;
      this.changed();
      return;
    }
    s.stopping = false;
    s.status.state = 'iniciando';
    s.status.lastError = null;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      SERVICE_HOST: process.env.SERVICE_HOST ?? '127.0.0.1',
    };
    const child = spawn(s.def.command, s.def.args, {
      cwd: s.def.cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    s.child = child;
    s.status.pid = child.pid ?? null;
    s.status.startedAt = Date.now();
    this.savePids();
    const push = (chunk: Buffer) => {
      const text = chunk.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        s.status.log.push(line.slice(0, 500));
        if (
          s.status.state === 'iniciando' &&
          /rodando|listening|running|ws:\/\/|PTY em|http:\/\//i.test(line)
        )
          s.status.state = 'rodando';
      }
      if (s.status.log.length > LOG_LINES) s.status.log.splice(0, s.status.log.length - LOG_LINES);
    };
    child.stdout?.on('data', push);
    child.stderr?.on('data', push);
    child.on('error', (err) => {
      s.status.lastError = err.message;
    });
    child.on('exit', (code, signal) => {
      s.child = null;
      s.status.pid = null;
      if (s.stopping) {
        s.status.state = 'parado';
        this.changed();
        return;
      }
      s.status.state = 'caiu';
      s.status.lastError = `saiu com código ${code ?? signal}`;
      s.status.restarts++;
      // A service that crashes right away is retried slower and slower.
      const ranFor = Date.now() - (s.status.startedAt ?? 0);
      s.backoff = ranFor > 120_000 ? 2_000 : Math.min(MAX_BACKOFF_MS, s.backoff * 2);
      s.timer = setTimeout(() => {
        s.timer = null;
        if (s.status.enabled) this.start(id);
      }, s.backoff);
      this.changed();
    });
    // Health probe marks it running even when the log line differs.
    if (s.def.health) {
      const port = s.status.port;
      const probe = (tries: number) => {
        if (!s.child || s.status.state !== 'iniciando' || tries <= 0) return;
        fetch(`http://127.0.0.1:${port}${s.def.health}`, { signal: AbortSignal.timeout(1500) })
          .then((r) => {
            if (r.ok && s.status.state === 'iniciando') {
              s.status.state = 'rodando';
              this.changed();
            }
          })
          .catch(() => setTimeout(() => probe(tries - 1), 1500));
      };
      setTimeout(() => probe(20), 1500);
    }
    this.changed();
  }

  stop(id: string): void {
    const s = this.services.get(id);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.stopping = true;
    if (s.child?.pid) killTree(s.child.pid);
    s.child = null;
    s.status.state = 'parado';
    this.changed();
  }

  restart(id: string): void {
    // A service turned off stays off: restart is for running ones.
    if (!this.services.get(id)?.status.enabled) return;
    this.stop(id);
    setTimeout(() => this.start(id), 800);
  }

  setEnabled(id: string, enabled: boolean): void {
    const s = this.services.get(id);
    if (!s) return;
    s.status.enabled = enabled;
    if (enabled) this.start(id);
    else {
      this.stop(id);
      s.status.state = 'desligado';
    }
    this.changed();
  }

  dispose(): void {
    for (const s of this.services.values()) {
      s.status.enabled = false;
      this.stop(s.def.id);
    }
  }

  private changed(): void {
    this.onChange?.();
  }
}

function killTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // already gone
  }
}
