// Role-scoped tool exposure (the "skilder" pattern) + per-call telemetry.
//
// Every tool belongs to one or more roles. A session only exposes the roles in MCB_ROLES
// (default: all), so a focused subagent loads ~10 tool schemas instead of ~45. Other roles can
// be switched on mid-session with `enable_role`; the server then emits tools/list_changed.
import { randomUUID } from 'node:crypto';
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as brain from '@mcb/core';

export const ROLES = {
  core: 'Contexto, busca e controle do run',
  ingest: 'Coleta: fontes, links, páginas sem feed, redes sociais, busca autônoma',
  triage: 'Triagem e análise de conteúdo, duplicados, feedback, mapa de conhecimento',
  learn: 'Aulas, trilhas, metas, recursos de estudo e revisão de exercícios',
  build: 'Projetos, Build Watch e GitHub em alta',
  people: 'Pessoas seguidas e seus posts',
  catchup: 'Histórico e linha do tempo do Catch-up',
  brief: 'Publicação do Daily/Weekly Brief',
} as const;
export type Role = keyof typeof ROLES;
const ROLE_NAMES = Object.keys(ROLES) as [Role, ...Role[]];

/** tool → roles. Tools missing here are treated as `core` so nothing silently disappears. */
const ROLE_OF: Record<string, Role[]> = {
  get_context: ['core'],
  search: ['core'],
  start_run: ['core'],
  finish_run: ['core'],
  list_sources: ['ingest'],
  add_source: ['ingest'],
  add_link: ['ingest'],
  sync_topic_sources: ['ingest'],
  ingest_sources: ['ingest'],
  list_due_pages: ['ingest'],
  mark_page_checked: ['ingest'],
  add_discovered_content: ['ingest', 'catchup'],
  list_pending_content: ['triage', 'catchup'],
  get_content: ['triage', 'catchup', 'learn', 'brief'],
  list_content: ['triage', 'brief', 'catchup'],
  save_content_analysis: ['triage', 'catchup'],
  ignore_content: ['triage', 'catchup'],
  mark_duplicate: ['triage', 'catchup'],
  get_feedback: ['triage'],
  record_feedback: ['triage'],
  upsert_knowledge: ['triage', 'learn', 'catchup'],
  upsert_learning_item: ['learn', 'triage'],
  upsert_learning_path: ['learn'],
  list_lessons_to_write: ['learn'],
  write_lesson: ['learn'],
  list_answers_to_review: ['learn'],
  review_answer: ['learn'],
  list_goals: ['learn'],
  create_goal: ['learn'],
  update_goal: ['learn'],
  add_learning_resources: ['learn'],
  suggest_project: ['build', 'learn'],
  update_project: ['build'],
  add_build_watch: ['build', 'triage'],
  list_trending_repos: ['build', 'brief', 'triage'],
  annotate_repo: ['build', 'triage'],
  track_repos: ['build', 'triage', 'ingest'],
  list_creators: ['people', 'ingest'],
  add_creator: ['people'],
  suggest_creator: ['people'],
  list_creator_posts: ['people', 'brief', 'triage'],
  backfill_history: ['catchup'],
  add_milestones: ['catchup'],
  list_milestones: ['catchup'],
  publish_brief: ['brief'],
};

type Entry = { name: string; roles: Role[]; tool: RegisteredTool; bytes: number };

function parseRoles(raw: string | undefined): Set<Role> {
  const list = (raw ?? 'all')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (!list.length || list.includes('all')) return new Set(ROLE_NAMES);
  return new Set(['core', ...list.filter((r): r is Role => r in ROLES)]);
}

/** Approximate size of what the client loads into context for a tool (name + description + JSON schema). */
function schemaBytes(
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodType> },
) {
  let schema = '{}';
  try {
    schema = JSON.stringify(z.toJSONSchema(z.object(config.inputSchema ?? {})));
  } catch {}
  return name.length + (config.description?.length ?? 0) + schema.length;
}

export function installRoles(server: McpServer) {
  const sessionId = randomUUID();
  const agent = process.env.MCB_AGENT ?? null;
  const active = parseRoles(process.env.MCB_ROLES);
  const all = !ROLE_NAMES.some((r) => !active.has(r));
  const entries: Entry[] = [];
  const register = server.registerTool.bind(server) as (...a: any[]) => RegisteredTool;

  // Wrap every registration: role bookkeeping + timing/error telemetry.
  (server as any).registerTool = (name: string, config: any, handler: (...a: any[]) => any) => {
    const timed = async (...args: any[]) => {
      const startedAt = new Date().toISOString();
      const t0 = performance.now();
      try {
        const res = await handler(...args);
        brain.logToolCall({
          sessionId,
          tool: name,
          startedAt,
          ms: performance.now() - t0,
          ok: !res?.isError,
          error: res?.isError ? res.content?.[0]?.text : null,
        });
        return res;
      } catch (e) {
        brain.logToolCall({
          sessionId,
          tool: name,
          startedAt,
          ms: performance.now() - t0,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    };
    const tool = register(name, config, timed);
    entries.push({
      name,
      roles: ROLE_OF[name] ?? ['core'],
      tool,
      bytes: schemaBytes(name, config),
    });
    return tool;
  };

  const exposed = () => entries.filter((e) => e.tool.enabled);
  const snapshot = () => ({
    tools: exposed().length,
    bytes: exposed().reduce((a, e) => a + e.bytes, 0),
  });

  /** Call after every tool is registered and before connect(). */
  function finalize() {
    for (const e of entries) if (!e.roles.some((r) => active.has(r))) e.tool.disable();
    if (!all) {
      register(
        'enable_role',
        {
          title: 'Enable more tools',
          description: `This session exposes only some tool roles (${[...active].join(', ')}). Enable another role when the task needs it. Roles: ${ROLE_NAMES.map((r) => `${r} = ${ROLES[r]}`).join('; ')}.`,
          inputSchema: { roles: z.array(z.enum(ROLE_NAMES)).min(1) },
        },
        async ({ roles }: { roles: Role[] }) => {
          const before = new Set(exposed().map((e) => e.name));
          for (const r of roles) active.add(r);
          for (const e of entries)
            if (!e.tool.enabled && e.roles.some((r) => active.has(r))) e.tool.enable();
          const s = snapshot();
          brain.updateMcpSessionTools(sessionId, [...active], s.tools, s.bytes);
          const added = exposed()
            .map((e) => e.name)
            .filter((n) => !before.has(n));
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  { enabled: roles, newTools: added, totalTools: s.tools },
                  null,
                  2,
                ),
              },
            ],
          };
        },
      );
    }
    const s = snapshot();
    brain.startMcpSession({
      id: sessionId,
      agent,
      roles: [...active],
      toolsExposed: s.tools + (all ? 0 : 1),
      schemaBytes: s.bytes,
    });
    return { sessionId, roles: [...active], ...s };
  }

  return { finalize, entries };
}

/** For the baseline script: tools and schema size each role set would expose. */
export function roleFootprint(
  entries: { name: string; roles: Role[]; bytes: number }[],
  roles: Role[],
) {
  const set = new Set<Role>(['core', ...roles]);
  const list = entries.filter((e) => e.roles.some((r) => set.has(r)));
  return { tools: list.length, bytes: list.reduce((a, e) => a + e.bytes, 0) };
}
