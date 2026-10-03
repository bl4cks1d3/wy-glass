import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { BrainService } from './brainService.js';
import { LocalDataError } from './localData.js';
import type { Autonomy, BrainSettings } from './types.js';

const SSE_KEEPALIVE_MS = 25_000;
const MAX_MESSAGE_CHARS = 20_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function hasValidToken(req: FastifyRequest, token: string): boolean {
  const header = req.headers['x-brain-token'];
  if (typeof header === 'string' && safeEqual(header, token)) return true;
  const q = (req.query as Record<string, unknown> | undefined)?.bt;
  return typeof q === 'string' && safeEqual(q, token);
}

/** The office page itself, opened on this machine. Three checks, because the
 *  brain routes run agents on the user's subscription:
 *  - Host must be loopback: a DNS-rebinding page (evil.com -> 127.0.0.1) keeps
 *    its own hostname in Host, and LAN access (--host 0.0.0.0) still needs the token.
 *  - A browser Origin, when sent, must be this same host: any other site's
 *    fetch/POST carries its own Origin and is refused.
 *  - Sec-Fetch-Site, when sent, must not say the request came from another site. */
function isLocalSameOrigin(req: FastifyRequest): boolean {
  const host = req.headers.host ?? '';
  if (!LOOPBACK_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}

/** Token (LAN, scripts) or the local office page (no token needed). */
export function authorized(req: FastifyRequest, token: string): boolean {
  return hasValidToken(req, token) || isLocalSameOrigin(req);
}

export function registerBrainRoutes(
  app: FastifyInstance,
  brain: BrainService,
  token: string,
): void {
  app.register(
    async (scope) => {
      scope.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        if (!authorized(req, token)) {
          await reply
            .code(401)
            .send({ error: 'abra o escritório em localhost ou informe o token do painel' });
        }
      });

      // ── Local data (no agent, no tokens) ──
      const local = async (reply: FastifyReply, fn: () => unknown, changes = false) => {
        try {
          const out = fn();
          // Written data changes the room signs and the Hoje tab.
          if (changes) void brain.refreshHoje();
          return out;
        } catch (err) {
          if (err instanceof LocalDataError)
            return reply.code(err.status).send({ error: err.message });
          throw err;
        }
      };
      type Body = Record<string, unknown>;
      scope.get('/local/planner', async (_req, reply) =>
        local(reply, () => brain.local.plannerAll()),
      );
      scope.post<{ Params: { entity: string }; Body: Body }>(
        '/local/planner/:entity',
        async (req, reply) =>
          local(
            reply,
            () => brain.local.plannerWrite(req.params.entity, 'create', null, req.body ?? {}),
            true,
          ),
      );
      scope.patch<{ Params: { entity: string; id: string }; Body: Body }>(
        '/local/planner/:entity/:id',
        async (req, reply) =>
          local(
            reply,
            () =>
              brain.local.plannerWrite(req.params.entity, 'update', req.params.id, req.body ?? {}),
            true,
          ),
      );
      scope.delete<{ Params: { entity: string; id: string } }>(
        '/local/planner/:entity/:id',
        async (req, reply) =>
          local(
            reply,
            () => brain.local.plannerWrite(req.params.entity, 'delete', req.params.id, {}),
            true,
          ),
      );
      scope.get<{ Params: { collection: string } }>(
        '/local/records/:collection',
        async (req, reply) => local(reply, () => brain.local.records(req.params.collection)),
      );
      scope.post<{ Params: { collection: string }; Body: Body }>(
        '/local/records/:collection',
        async (req, reply) => {
          const b = req.body ?? {};
          const create =
            b.create && typeof b.create === 'object'
              ? (b.create as { label: string; fields: Array<{ name: string; type: string }> })
              : undefined;
          return local(
            reply,
            () => brain.local.recordWrite(req.params.collection, 'create', null, b, create),
            true,
          );
        },
      );
      scope.patch<{ Params: { collection: string; id: string }; Body: Body }>(
        '/local/records/:collection/:id',
        async (req, reply) =>
          local(
            reply,
            () =>
              brain.local.recordWrite(
                req.params.collection,
                'update',
                req.params.id,
                req.body ?? {},
              ),
            true,
          ),
      );
      scope.delete<{ Params: { collection: string; id: string } }>(
        '/local/records/:collection/:id',
        async (req, reply) =>
          local(
            reply,
            () => brain.local.recordWrite(req.params.collection, 'delete', req.params.id, {}),
            true,
          ),
      );
      scope.get('/local/notes', async (_req, reply) =>
        local(reply, () => ({ notes: brain.local.listNotes() })),
      );
      scope.get<{ Querystring: { path?: string } }>('/local/note', async (req, reply) =>
        local(reply, () => brain.local.readNote(req.query.path ?? '')),
      );
      scope.put<{ Body: { path?: unknown; content?: unknown } }>(
        '/local/note',
        async (req, reply) =>
          local(reply, () =>
            brain.local.writeNote(String(req.body?.path ?? ''), req.body?.content),
          ),
      );
      scope.get<{ Params: { view: string }; Querystring: Record<string, string | undefined> }>(
        '/local/brain/:view',
        async (req, reply) => local(reply, () => brain.local.brainView(req.params.view, req.query)),
      );
      scope.post<{ Params: { kind: string; id: string }; Body: Body }>(
        '/local/brain/:kind/:id',
        async (req, reply) =>
          local(
            reply,
            () => brain.local.brainWrite(req.params.kind, req.params.id, req.body ?? {}),
            true,
          ),
      );
      scope.get('/local/widgets', async () => ({ widgets: brain.persistence.loadWidgets() }));
      scope.put<{ Body: { widgets?: unknown } }>('/local/widgets', async (req, reply) => {
        if (!Array.isArray(req.body?.widgets))
          return reply.code(400).send({ error: 'widgets deve ser uma lista' });
        brain.persistence.saveWidgets(req.body.widgets);
        return { ok: true };
      });

      scope.get('/agents', async () => ({ agents: brain.getAgents() }));

      scope.post('/agents/refresh', async () => {
        brain.refreshRegistry();
        return { agents: brain.getAgents() };
      });

      scope.get<{ Params: { key: string }; Querystring: { limit?: string } }>(
        '/agents/:key/chat',
        async (req) => ({ entries: brain.getChat(req.params.key, Number(req.query.limit) || 200) }),
      );

      scope.post<{ Params: { key: string }; Body: { text?: unknown; force?: unknown } }>(
        '/agents/:key/messages',
        async (req, reply) => {
          const text =
            typeof req.body?.text === 'string' ? req.body.text.slice(0, MAX_MESSAGE_CHARS) : '';
          if (!text.trim()) return reply.code(400).send({ error: 'mensagem vazia' });
          // Fire and forget: progress and the reply arrive over /events.
          brain
            .send(req.params.key, text, { kind: 'user', force: req.body?.force === true })
            .catch(() => {});
          return { queued: true };
        },
      );

      scope.post<{ Params: { key: string } }>('/agents/:key/stop', async (req) => {
        brain.stop(req.params.key);
        return { ok: true };
      });

      scope.post<{ Params: { key: string }; Body: { autonomy?: unknown } }>(
        '/agents/:key/autonomy',
        async (req, reply) => {
          const a = req.body?.autonomy;
          if (a !== 'supervisionado' && a !== 'autonomo')
            return reply.code(400).send({ error: 'autonomia inválida' });
          return { ok: brain.setAutonomy(req.params.key, a as Autonomy) };
        },
      );

      scope.post<{ Params: { key: string }; Body: { model?: unknown } }>(
        '/agents/:key/model',
        async (req) => ({
          ok: brain.setModel(
            req.params.key,
            typeof req.body?.model === 'string' ? req.body.model : '',
          ),
        }),
      );

      scope.delete<{ Params: { key: string; id: string } }>(
        '/agents/:key/rules/:id',
        async (req) => ({ ok: brain.removeRule(req.params.key, req.params.id) }),
      );

      scope.get('/queue', async () => ({ items: brain.getQueue() }));

      scope.delete<{ Params: { id: string } }>('/queue/:id', async (req) => ({
        ok: brain.cancelQueued(req.params.id),
      }));

      scope.post('/stop-all', async () => {
        brain.stopAll();
        return { ok: true };
      });

      scope.post<{ Params: { key: string }; Body: { enabled?: unknown } }>(
        '/agents/:key/enabled',
        async (req, reply) => {
          if (typeof req.body?.enabled !== 'boolean')
            return reply.code(400).send({ error: 'enabled deve ser booleano' });
          return { ok: brain.setEnabled(req.params.key, req.body.enabled) };
        },
      );

      scope.post<{ Body: { text?: unknown; force?: unknown } }>('/route', async (req, reply) => {
        const text =
          typeof req.body?.text === 'string' ? req.body.text.slice(0, MAX_MESSAGE_CHARS) : '';
        if (!text.trim()) return reply.code(400).send({ error: 'mensagem vazia' });
        return brain.routeMessage(text, req.body?.force === true);
      });

      scope.get('/reminders', async () => ({ reminders: brain.getReminders() }));

      scope.post<{
        Body: {
          agent?: unknown;
          text?: unknown;
          inMinutes?: unknown;
          at?: unknown;
          everyMinutes?: unknown;
          windowStart?: unknown;
          windowEnd?: unknown;
        };
      }>('/reminders', async (req, reply) => {
        const b = req.body ?? {};
        const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
        const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
        const r = brain.addReminder(String(b.agent ?? ''), {
          text: String(b.text ?? ''),
          inMinutes: num(b.inMinutes),
          at: str(b.at),
          everyMinutes: num(b.everyMinutes),
          windowStart: str(b.windowStart),
          windowEnd: str(b.windowEnd),
        });
        return typeof r === 'string' ? reply.code(400).send({ error: r }) : { reminder: r };
      });

      scope.delete<{ Params: { id: string } }>('/reminders/:id', async (req) => ({
        ok: brain.removeReminder(req.params.id),
      }));

      scope.post<{ Params: { id: string }; Body: { active?: unknown } }>(
        '/reminders/:id/active',
        async (req, reply) => {
          if (typeof req.body?.active !== 'boolean')
            return reply.code(400).send({ error: 'active deve ser booleano' });
          return { ok: brain.setReminderActive(req.params.id, req.body.active) };
        },
      );

      scope.post<{ Params: { key: string }; Body: { text?: unknown } }>(
        '/agents/:key/nudge',
        async (req, reply) => {
          const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
          if (!text) return reply.code(400).send({ error: 'texto vazio' });
          return { nudge: brain.nudge(req.params.key, text) };
        },
      );

      scope.post<{ Params: { key: string }; Body: { paused?: unknown; runNow?: unknown } }>(
        '/agents/:key/routine',
        async (req) => ({
          ok: brain.setRoutine(req.params.key, {
            paused: typeof req.body?.paused === 'boolean' ? req.body.paused : undefined,
            runNow: req.body?.runNow === true,
          }),
        }),
      );

      scope.get('/permissions', async () => ({ requests: brain.getPermissions() }));

      scope.post<{
        Params: { id: string };
        Body: { allow?: unknown; message?: unknown; remember?: unknown };
      }>('/permissions/:id', async (req, reply) => {
        if (typeof req.body?.allow !== 'boolean')
          return reply.code(400).send({ error: 'allow deve ser booleano' });
        const message = typeof req.body.message === 'string' ? req.body.message : undefined;
        return {
          ok: brain.resolvePermission(
            req.params.id,
            req.body.allow,
            message,
            req.body.remember === true,
          ),
        };
      });

      scope.get<{ Querystring: { limit?: string } }>('/board', async (req) => ({
        posts: brain.persistence.readBoard(Number(req.query.limit) || 200),
      }));

      scope.get<{ Querystring: { refresh?: string } }>('/hoje', async (req) => ({
        hoje:
          req.query.refresh === '1'
            ? await brain.refreshHoje()
            : (brain.getHoje() ?? (await brain.refreshHoje())),
      }));

      scope.post('/board/clear', async () => {
        brain.clearBoard();
        return { ok: true };
      });

      scope.delete<{ Params: { id: string } }>('/board/:id', async (req) => ({
        ok: brain.removeBoardPost(req.params.id),
      }));

      scope.get('/briefs', async () => ({ briefs: brain.persistence.listBriefs() }));

      scope.get<{ Params: { id: string } }>('/briefs/:id', async (req, reply) => {
        const b = brain.persistence.readBrief(req.params.id);
        return b ?? reply.code(404).send({ error: 'brief não encontrado' });
      });

      scope.post('/briefs/run', async () => {
        brain.runBrief().catch(() => {});
        return { queued: true };
      });

      scope.get('/settings', async () => ({ settings: brain.getSettings() }));

      scope.post<{ Body: Partial<BrainSettings> }>('/settings', async (req) => ({
        settings: brain.updateSettings(req.body ?? {}),
      }));

      scope.get<{ Querystring: { refresh?: string } }>('/usage', async (req) => {
        if (req.query.refresh === '1') await brain.refreshUsage();
        return brain.getUsage();
      });

      scope.get('/consumption', async () => brain.getConsumption());

      scope.get('/events', (req, reply) => {
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': conectado\n\n');
        const off = brain.onEvent((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
        const keepalive = setInterval(() => res.write(': ping\n\n'), SSE_KEEPALIVE_MS);
        req.raw.on('close', () => {
          clearInterval(keepalive);
          off();
        });
      });
    },
    { prefix: '/api/brain' },
  );
}
