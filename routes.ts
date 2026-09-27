import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { BrainService } from './brainService.js';
import type { Autonomy, BrainSettings } from './types.js';

const SSE_KEEPALIVE_MS = 25_000;
const MAX_MESSAGE_CHARS = 20_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Every brain route runs agents on the user's subscription or exposes their
 *  conversations, so all of them require the brain token: the `x-brain-token`
 *  header, or `?bt=` for EventSource, which cannot set headers. */
function authorized(req: FastifyRequest, token: string): boolean {
  const header = req.headers['x-brain-token'];
  if (typeof header === 'string' && safeEqual(header, token)) return true;
  const q = (req.query as Record<string, unknown> | undefined)?.bt;
  return typeof q === 'string' && safeEqual(q, token);
}

export function registerBrainRoutes(app: FastifyInstance, brain: BrainService, token: string): void {
  app.register(
    async (scope) => {
      scope.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
        if (!authorized(req, token)) {
          await reply.code(401).send({ error: 'token do painel inválido' });
        }
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
          const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, MAX_MESSAGE_CHARS) : '';
          if (!text.trim()) return reply.code(400).send({ error: 'mensagem vazia' });
          // Fire and forget: progress and the reply arrive over /events.
          brain.send(req.params.key, text, { kind: 'user', force: req.body?.force === true }).catch(() => {});
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
          if (a !== 'supervisionado' && a !== 'autonomo') return reply.code(400).send({ error: 'autonomia inválida' });
          return { ok: brain.setAutonomy(req.params.key, a as Autonomy) };
        },
      );

      scope.post<{ Params: { key: string }; Body: { enabled?: unknown } }>(
        '/agents/:key/enabled',
        async (req, reply) => {
          if (typeof req.body?.enabled !== 'boolean') return reply.code(400).send({ error: 'enabled deve ser booleano' });
          return { ok: brain.setEnabled(req.params.key, req.body.enabled) };
        },
      );

      scope.post<{ Body: { text?: unknown; force?: unknown } }>('/route', async (req, reply) => {
        const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, MAX_MESSAGE_CHARS) : '';
        if (!text.trim()) return reply.code(400).send({ error: 'mensagem vazia' });
        return brain.routeMessage(text, req.body?.force === true);
      });

      scope.get('/reminders', async () => ({ reminders: brain.getReminders() }));

      scope.post<{ Body: { agent?: unknown; text?: unknown; inMinutes?: unknown; at?: unknown; everyMinutes?: unknown; windowStart?: unknown; windowEnd?: unknown } }>(
        '/reminders',
        async (req, reply) => {
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
        },
      );

      scope.delete<{ Params: { id: string } }>('/reminders/:id', async (req) => ({
        ok: brain.removeReminder(req.params.id),
      }));

      scope.post<{ Params: { id: string }; Body: { active?: unknown } }>('/reminders/:id/active', async (req, reply) => {
        if (typeof req.body?.active !== 'boolean') return reply.code(400).send({ error: 'active deve ser booleano' });
        return { ok: brain.setReminderActive(req.params.id, req.body.active) };
      });

      scope.post<{ Params: { key: string }; Body: { text?: unknown } }>('/agents/:key/nudge', async (req, reply) => {
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text) return reply.code(400).send({ error: 'texto vazio' });
        return { nudge: brain.nudge(req.params.key, text) };
      });

      scope.get('/permissions', async () => ({ requests: brain.getPermissions() }));

      scope.post<{ Params: { id: string }; Body: { allow?: unknown; message?: unknown } }>(
        '/permissions/:id',
        async (req, reply) => {
          if (typeof req.body?.allow !== 'boolean') return reply.code(400).send({ error: 'allow deve ser booleano' });
          const message = typeof req.body.message === 'string' ? req.body.message : undefined;
          return { ok: brain.resolvePermission(req.params.id, req.body.allow, message) };
        },
      );

      scope.get<{ Querystring: { limit?: string } }>('/board', async (req) => ({
        posts: brain.persistence.readBoard(Number(req.query.limit) || 200),
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
