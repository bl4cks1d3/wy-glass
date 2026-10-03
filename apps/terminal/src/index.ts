// Local companion process for the web app:
//   1. Terminal: a real Claude Code session (PTY) exposed over a WebSocket on 127.0.0.1 only,
//      guarded by a random token + Origin check. The browser renders it with xterm.js.
//      It is the user's own `claude` CLI, so usage stays on their subscription.
//   2. Worker: collects due sources every few minutes (no AI), so news arrive every day even
//      when the agent hasn't run yet.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type IPty } from '@lydell/node-pty';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  collectGithub,
  ingestSources,
  resolveDbPath,
  scanMentions,
  seedInit,
  syncTopicSources,
} from '@mcb/core';
import { createApi } from './api.js';

const PORT = Number(process.env.MCB_TERMINAL_PORT ?? 3031);
const WEB_PORT = process.env.PORT ?? '3000';
const WEB_ORIGINS = new Set(
  (process.env.MCB_WEB_ORIGIN ?? `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`).split(
    ',',
  ),
);
const INGEST_EVERY_MIN = Number(process.env.MCB_INGEST_EVERY_MIN ?? 10);
const SCROLLBACK = 200_000;

const dataDir = dirname(resolveDbPath());
// services/brain is where .mcp.json and .claude/ live, so `claude` picks up the agent and MCP.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const token = randomBytes(24).toString('hex');
// One file per port, so a second copy of the app (e.g. a demo) never hijacks the main terminal.
const infoFile = join(dataDir, `terminal-${PORT}.json`);

// ─── PTY session (shared by every connected tab) ────────────────────────────

let pty: IPty | null = null;
let buffer = '';
const clients = new Set<WebSocket>();
let size = { cols: 120, rows: 30 };

function broadcast(msg: object) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === c.OPEN) c.send(s);
}

function start() {
  const env = { ...process.env } as Record<string, string>;
  // Same rule as scripts/run-agent.ps1: never fall back to API billing.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  const [file, args] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoLogo', '-NoExit', '-Command', 'claude']]
      : [process.env.SHELL ?? '/bin/bash', ['-lc', 'claude; exec $SHELL -l']];
  buffer = '';
  pty = spawn(file, args, {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: repoRoot,
    env,
  });
  pty.onData((data) => {
    buffer = (buffer + data).slice(-SCROLLBACK);
    broadcast({ type: 'output', data });
  });
  pty.onExit(({ exitCode }) => {
    broadcast({ type: 'exit', code: exitCode });
    pty = null;
  });
}

// ─── HTTP + WebSocket ───────────────────────────────────────────────────────

const api = createApi(repoRoot, token);

const server = createServer(async (req, res) => {
  if (await api(req, res)) return;
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, session: !!pty, clients: clients.size, lastIngest }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const origin = req.headers.origin ?? '';
  if (
    url.pathname !== '/pty' ||
    url.searchParams.get('token') !== token ||
    !WEB_ORIGINS.has(origin)
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  clients.add(ws);
  if (!pty) start();
  ws.send(JSON.stringify({ type: 'output', data: buffer }));
  ws.on('message', (raw) => {
    let msg: { type: string; data?: string; cols?: number; rows?: number };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      if (!pty) start();
      pty!.write(msg.data);
    } else if (msg.type === 'resize' && msg.cols && msg.rows) {
      size = { cols: Math.max(20, msg.cols), rows: Math.max(5, msg.rows) };
      pty?.resize(size.cols, size.rows);
    } else if (msg.type === 'restart') {
      pty?.kill();
      pty = null;
      start();
    }
  });
  ws.on('close', () => clients.delete(ws));
});

server.listen(PORT, '127.0.0.1', () => {
  writeFileSync(
    infoFile,
    JSON.stringify({ port: PORT, token, pid: process.pid, startedAt: new Date().toISOString() }),
  );
  console.log(`[terminal] ws://127.0.0.1:${PORT}/pty · cwd ${repoRoot}`);
});

// ─── Worker: scheduled collection ───────────────────────────────────────────

let lastIngest: string | null = null;
let lastGithubDay: string | null = null;
async function collect() {
  try {
    seedInit();
    syncTopicSources();
    const since = new Date().toISOString();
    const report = await ingestSources();
    lastIngest = new Date().toISOString();
    const inserted = report.reduce((a, r) => a + r.inserted, 0);
    const mentions = scanMentions(new Date(Date.parse(since) - 60_000).toISOString());
    if (report.length)
      console.log(
        `[worker] ${report.length} fontes · ${inserted} novos · ${mentions} repos citados · ${report.filter((r) => r.error).length} erros`,
      );
    // GitHub trending / rising / star history once a day
    const day = lastIngest.slice(0, 10);
    if (lastGithubDay !== day) {
      lastGithubDay = day;
      const g = await collectGithub();
      console.log(
        `[worker] github · ${g.trending} trending · ${g.rising} em alta · ${g.refreshed} atualizados${g.errors.length ? ` · ${g.errors[0]}` : ''}`,
      );
    }
  } catch (e) {
    console.error('[worker] coleta falhou:', e);
  }
}
setTimeout(collect, 15_000);
setInterval(collect, INGEST_EVERY_MIN * 60_000);

const shutdown = () => {
  pty?.kill();
  rmSync(infoFile, { force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
