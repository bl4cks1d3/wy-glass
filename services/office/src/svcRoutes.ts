import fastifyHttpProxy from '@fastify/http-proxy';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as fs from 'fs';
import type { IncomingMessage } from 'http';
import * as path from 'path';
import WebSocket from 'ws';

import { authorized } from './routes.js';
import type { ServiceSupervisor } from './services.js';

/** One origin for everything: the browser talks only to this server, which
 *  forwards /svc/<service>/* to the service on 127.0.0.1. Every proxied call
 *  goes through the same check as /api/brain (local page or panel token). */

interface ProxyDef {
  prefix: string;
  service: string;
  websocket?: boolean;
}

const PROXIES: ProxyDef[] = [
  { prefix: '/svc/planner', service: 'planner-core' },
  { prefix: '/svc/agent', service: 'planner-agent' },
  { prefix: '/svc/voice', service: 'planner-voice', websocket: true },
  { prefix: '/svc/terminal', service: 'planner-terminal', websocket: true },
  { prefix: '/svc/p2p', service: 'p2p' },
];

export function registerServiceRoutes(
  app: FastifyInstance,
  supervisor: ServiceSupervisor,
  token: string,
  brainDataDir: string,
): void {
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authorized(req, token)) {
      await reply
        .code(401)
        .send({ error: 'abra o escritório em localhost ou informe o token do painel' });
    }
  };

  // ── Supervisor status and control ──
  app.register(async (scope) => {
    scope.addHook('onRequest', guard);
    scope.get('/api/brain/services', async () => ({ services: supervisor.list() }));
    scope.post<{ Params: { id: string } }>(
      '/api/brain/services/:id/restart',
      async (req, reply) => {
        if (!supervisor.get(req.params.id))
          return reply.code(404).send({ error: 'serviço desconhecido' });
        supervisor.restart(req.params.id);
        return { ok: true };
      },
    );
    scope.post<{ Params: { id: string }; Body: { enabled?: boolean } }>(
      '/api/brain/services/:id/enabled',
      async (req, reply) => {
        if (!supervisor.get(req.params.id))
          return reply.code(404).send({ error: 'serviço desconhecido' });
        supervisor.setEnabled(req.params.id, req.body?.enabled !== false);
        return { ok: true };
      },
    );
  });

  // ── Planner services (HTTP + WebSocket) ──
  for (const p of PROXIES) {
    const port = supervisor.port(p.service);
    if (!port) continue;
    const upstream = `http://127.0.0.1:${port}`;
    app.register(fastifyHttpProxy, {
      upstream,
      prefix: p.prefix,
      rewritePrefix: '',
      websocket: p.websocket ?? false,
      preHandler: guard,
      replyOptions: {
        // The services check Host against their own port (DNS-rebinding guard).
        rewriteRequestHeaders: (_req: IncomingMessage, headers: Record<string, unknown>) => ({
          ...headers,
          host: `127.0.0.1:${port}`,
        }),
        onError: (reply: FastifyReply) => {
          void reply.code(502).send({ error: `${p.service} fora do ar: veja Controle > Serviços` });
        },
      },
      wsClientOptions: {
        // The browser's Origin already passed the guard; the service checks it again.
        rewriteRequestHeaders: (headers: Record<string, unknown>, req: FastifyRequest) => ({
          ...headers,
          ...(req.headers.origin ? { origin: req.headers.origin } : {}),
        }),
      },
    } as never);
  }

  // ── Current Brain: RPC with the worker's private token ──
  const workerInfo = (): { port: number; token: string } | null => {
    const port = supervisor.port('brain-worker');
    const f = path.join(brainDataDir, `terminal-${port}.json`);
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { port?: number; token?: string };
      return j.port && j.token ? { port: j.port, token: j.token } : null;
    } catch {
      return null;
    }
  };

  app.register(async (scope) => {
    scope.addHook('onRequest', guard);
    scope.post<{ Params: { fn: string }; Body: unknown }>(
      '/svc/brain/rpc/:fn',
      async (req, reply) => {
        if (!/^[A-Za-z]+$/.test(req.params.fn))
          return reply.code(400).send({ error: 'função inválida' });
        const info = workerInfo();
        if (!info)
          return reply
            .code(502)
            .send({ error: 'Current Brain fora do ar: veja Controle > Serviços' });
        try {
          const r = await fetch(`http://127.0.0.1:${info.port}/rpc/${req.params.fn}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-svc-token': info.token },
            body: JSON.stringify(req.body ?? []),
            signal: AbortSignal.timeout(10 * 60_000),
          });
          return reply
            .code(r.status)
            .type('application/json')
            .send(await r.text());
        } catch (err) {
          return reply
            .code(502)
            .send({
              error: `Current Brain não respondeu: ${err instanceof Error ? err.message : String(err)}`,
            });
        }
      },
    );
    scope.get('/svc/brain/health', async (_req, reply) => {
      const info = workerInfo();
      if (!info) return reply.code(502).send({ up: false });
      try {
        const r = await fetch(`http://127.0.0.1:${info.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        return await r.json();
      } catch {
        return reply.code(502).send({ up: false });
      }
    });
    scope.get('/svc/brain/terminal-info', async (_req, reply) => {
      // The PTY socket token stays server side: the page connects to our /svc/brain/pty bridge.
      return workerInfo() ? { ok: true } : reply.code(502).send({ ok: false });
    });
  });

  // Claude Code terminal of the Current Brain (PTY on the worker), bridged so its token stays here.
  app.register(async (scope) => {
    scope.addHook('onRequest', guard);
    scope.get('/svc/brain/pty', { websocket: true }, (socket, req) => {
      const info = workerInfo();
      if (!info) {
        socket.close(1011, 'Current Brain fora do ar');
        return;
      }
      const upstream = new WebSocket(`ws://127.0.0.1:${info.port}/pty?token=${info.token}`, {
        headers: { origin: req.headers.origin ?? `http://${req.headers.host}` },
      });
      const pending: Array<string | Buffer> = [];
      upstream.on('open', () => {
        for (const m of pending.splice(0)) upstream.send(m);
      });
      upstream.on('message', (data, isBinary) => socket.send(isBinary ? data : data.toString()));
      upstream.on('close', () => socket.close());
      upstream.on('error', () => socket.close(1011, 'terminal indisponível'));
      socket.on('message', (data: Buffer) => {
        const msg = data.toString();
        if (upstream.readyState === WebSocket.OPEN) upstream.send(msg);
        else pending.push(msg);
      });
      socket.on('close', () => upstream.close());
    });
  });
}
