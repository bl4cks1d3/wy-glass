import "./env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { detectClaude } from "./profiles.js";
import { corsHeaders, hostAllowed, originAllowed } from "./security.js";
import { LimitError, ProfileError, SessionManager, clamp } from "./sessions.js";

const port = Number(process.env.TERMINAL_PORT ?? 4500);
const manager = new SessionManager();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function reply(res: ServerResponse, status: number, body: unknown, origin?: string): void {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(origin ? corsHeaders(origin) : {}) };
  res.writeHead(status, headers);
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new ProfileError("corpo grande demais"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new ProfileError("JSON invalido"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const origin = req.headers.origin;

  if (!hostAllowed(req.headers.host, port)) return reply(res, 403, { error: "host nao permitido" });

  if (req.method === "GET" && url.pathname === "/health") {
    return reply(res, 200, { ok: true, service: "planner-terminal", sessions: manager.list().length });
  }

  if (!originAllowed(origin)) return reply(res, 403, { error: "origem nao permitida" });

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  try {
    if (req.method === "GET" && url.pathname === "/claude") {
      return reply(res, 200, await detectClaude(), origin);
    }
    if (req.method === "GET" && url.pathname === "/sessions") {
      return reply(res, 200, manager.list(), origin);
    }
    if (req.method === "POST" && url.pathname === "/sessions") {
      const body = await readJson(req);
      return reply(res, 201, manager.create(body.profile, body.cols, body.rows), origin);
    }
    const match = url.pathname.match(/^\/sessions\/([0-9a-f-]{36})$/);
    if (req.method === "DELETE" && match) {
      return manager.kill(match[1]) ? reply(res, 200, { ok: true }, origin) : reply(res, 404, { error: "sessao nao encontrada" }, origin);
    }
    return reply(res, 404, { error: "rota nao encontrada" }, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof ProfileError ? 400 : err instanceof LimitError ? 429 : 500;
    return reply(res, status, { error: message }, origin);
  }
});

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/pty") return reject(socket, 404, "Not Found");
  if (!hostAllowed(req.headers.host, port) || !originAllowed(req.headers.origin)) {
    return reject(socket, 403, "Forbidden");
  }
  const session = manager.get(url.searchParams.get("session") ?? "");
  if (!session) return reject(socket, 404, "Not Found");
  const cols = clamp(url.searchParams.get("cols"), 1, 500, 100);
  const rows = clamp(url.searchParams.get("rows"), 1, 200, 30);
  wss.handleUpgrade(req, socket, head, (ws) => manager.attach(session, ws, cols, rows));
});

// So loopback: nada na rede local alcanca este servico.
server.listen(port, "127.0.0.1", () => {
  console.log(`[terminal] PTY em http://127.0.0.1:${port} (so loopback; origens: localhost:4300)`);
});

function shutdown(): void {
  manager.killAll();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => manager.killAll());
