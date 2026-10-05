#!/usr/bin/env node
// My Current Brain — MCP server (stdio).
//
// The product never calls an LLM API itself. All AI work (classification, summaries,
// "why it matters", gaps, briefs) is done by a Claude Code agent — running on the user's
// subscription — through these tools. The server only exposes deterministic, scoped
// operations over the local database (PTR §62: no "full database access").
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as brain from '@mcb/core';
import { installRoles } from './roles';
import {
  AREAS,
  CATEGORIES,
  FEEDBACK_SIGNALS,
  GOAL_STATUSES,
  KNOWLEDGE_STATUSES,
  MILESTONE_IMPORTANCE,
  PRIORITIES,
  PROJECT_STATUSES,
  RESOURCE_KINDS,
  TASK_STATUSES,
} from '@mcb/core';

const server = new McpServer(
  { name: 'current-brain', version: '0.1.0' },
  {
    instructions: [
      'My Current Brain: personal technical intelligence for ONE user.',
      'Start every task with get_context. Write all user-facing text in the profile language (default pt-BR): short, direct, technical, no hype, no emojis.',
      "Keep the three layers separate (PTR §66): source facts stay in the excerpt; `summary` is a factual rewrite grounded in the source; `whyItMatters` is your interpretation tied to the user's projects, knowledge and gaps.",
      "Quality over quantity: respect profile.limits. Most items should be ignored (P4) — only what connects to the user's goals, stack, projects or gaps should reach P0–P2.",
    ].join('\n'),
  },
);

// Must run before any registerTool: routes tools to roles and times every call.
const roles = installRoles(server);

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

const explainSchema = z
  .object({
    code: z
      .string()
      .optional()
      .describe('Short code snippet showing usage (plain text, no markdown fences).'),
    architecture: z.string().optional().describe('ASCII diagram of how the pieces connect.'),
    application: z
      .string()
      .optional()
      .describe("Concrete way to apply this in one of the user's projects."),
  })
  .describe(
    'The four explain modes on the content page: Resumo is `summary`; these are the other three.',
  );

const analysisSchema = {
  area: z
    .enum(AREAS)
    .describe(
      "now = happening; learn = fundamentals worth studying; build = directly buildable; frontier = emerging, just 'know it exists'.",
    ),
  category: z.enum(CATEGORIES),
  summary: z.string().describe('2–3 factual sentences grounded ONLY in the source.'),
  whyItMatters: z
    .string()
    .describe("1–2 sentences connecting to the user's projects/knowledge/gaps by name."),
  keyPoints: z.array(z.string()).max(5).describe("'O que você deveria saber' — 3 crisp points."),
  tags: z.array(z.string()).max(5).describe('Uppercase short tags: AI, AGENTS, PYTHON, SECURITY…'),
  priority: z
    .enum(PRIORITIES)
    .describe(
      "P0 critical (e.g. CVE in user's stack) · P1 high · P2 medium · P3 low. Use ignore_content for P4.",
    ),
  readMinutes: z.number().int().min(1).max(60),
  explain: explainSchema.optional(),
  relatedKnowledge: z
    .array(z.string())
    .optional()
    .describe('Knowledge node names this item touches (existing or new).'),
  learnTopic: z.string().nullable().optional().describe('Concept to study because of this item.'),
  maturity: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .optional()
    .describe('Frontier only: 1 = idea/paper, 5 = production-ready.'),
  signals: z
    .string()
    .nullable()
    .optional()
    .describe("Frontier only: evidence line, e.g. '3 papers · 2 repositórios'."),
};

// ─── Context ────────────────────────────────────────────────────────────────

server.registerTool(
  'get_context',
  {
    title: 'Get user context',
    description:
      'Profile, limits, knowledge map (with gaps), active projects, learning queue, recent feedback and pulse. Call this first.',
    inputSchema: {},
  },
  async () => {
    const knowledge = brain.listKnowledge();
    return ok({
      today: new Date().toISOString().slice(0, 10),
      profile: brain.getProfile(),
      pulse: brain.getPulse(),
      knowledge: knowledge.map(
        ({ name, status, confidence, domain, related, gapReason, nextStep }) => ({
          name,
          status,
          confidence,
          domain,
          related,
          gapReason,
          nextStep,
        }),
      ),
      projects: brain.listProjects({ includeSuggested: true }).map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        aiSuggested: p.aiSuggested,
        progress: brain.projectProgress(p),
        technologies: p.technologies,
        nextTask: p.tasks.find((t) => t.status !== 'DONE')?.title ?? null,
        missing: p.prerequisites.filter((x) => !x.known).map((x) => x.name),
      })),
      learning: brain
        .listLearning()
        .map(({ id, title, track, progress }) => ({ id, title, track, progress })),
      rejectedProjects: brain
        .listRejectedProjects(10)
        .map(({ name, goal, rejection, rejectedAt }) => ({ name, goal, rejection, rejectedAt })),
      pendingSuggestions: brain.listSuggestedProjects().map(({ id, name }) => ({ id, name })),
      paths: brain.listLearningPaths(),
      goals: brain.listGoals({ status: ['new', 'planning', 'active'] }),
      duePages: brain.listDuePageSources().map(({ id, name, url }) => ({ id, name, url })),
      recentFeedback: brain.listFeedback(30).slice(0, 40),
      lastRuns: brain.listAgentRuns(3),
    });
  },
);

// ─── Sources & ingestion ────────────────────────────────────────────────────

server.registerTool(
  'list_sources',
  {
    title: 'List sources',
    description: 'Configured sources with cadence, last fetch and last error.',
    inputSchema: {},
  },
  async () => ok(brain.listSources()),
);

server.registerTool(
  'add_source',
  {
    title: 'Add or update a source',
    description:
      'Add an RSS/Atom feed (GitHub releases: https://github.com/<owner>/<repo>/releases.atom) or a Hacker News Algolia query URL.',
    inputSchema: {
      kind: z.enum(['rss', 'hn']),
      name: z.string(),
      url: z.string().url(),
      defaultArea: z.enum(AREAS).nullable().optional(),
      everyMinutes: z.number().int().min(15).max(1440).optional(),
      enabled: z.boolean().optional(),
    },
  },
  async (args) => ok(brain.upsertSource(args)),
);

server.registerTool(
  'add_link',
  {
    title: 'Follow a link the user sent',
    description:
      "Turn any URL into a monitored source: detects GitHub releases, YouTube channel/playlist feeds, subreddit feeds, site RSS/Atom; otherwise registers a 'page' source you visit with WebFetch. Collects immediately and queues the link itself if it is an article/video.",
    inputSchema: { url: z.string().url() },
  },
  async ({ url }) => ok(await brain.addLink(url)),
);

server.registerTool(
  'sync_topic_sources',
  {
    title: 'Sync autonomous topic searches',
    description:
      "Create/disable Hacker News and GitHub search sources from the user's high/medium interests. Run before ingest_sources.",
    inputSchema: {},
  },
  async () => ok(brain.syncTopicSources()),
);

server.registerTool(
  'list_due_pages',
  {
    title: 'Pages to visit',
    description:
      'Sites without a feed that are due for a visit. WebFetch each one, add new articles with add_discovered_content, then call mark_page_checked.',
    inputSchema: {},
  },
  async () => ok(brain.listDuePageSources()),
);

server.registerTool(
  'mark_page_checked',
  {
    title: 'Mark page visited',
    description: "Record that a 'page' source was visited (optionally with an error).",
    inputSchema: { sourceId: z.string(), error: z.string().optional() },
  },
  async ({ sourceId, error }) => {
    brain.markSourceFetched(sourceId, error ?? null);
    return ok({ ok: true });
  },
);

server.registerTool(
  'add_discovered_content',
  {
    title: 'Add content you found',
    description:
      "Autonomous search: add articles, videos, repos or posts you found with WebSearch/WebFetch (or on a 'page' source). They enter as pending and go through the normal triage. Known URLs are skipped.",
    inputSchema: {
      items: z
        .array(
          z.object({
            url: z.string().url(),
            title: z.string(),
            excerpt: z.string().optional().describe('Short factual snippet from the page itself.'),
            author: z.string().optional(),
            publishedAt: z.string().optional().describe('ISO date if known.'),
            creatorId: z
              .string()
              .optional()
              .describe(
                'Person (list_creators) who posted it — for posts found on Instagram/TikTok/X/etc.',
              ),
            catchup: z
              .boolean()
              .optional()
              .describe('true when found for the catch-up task (history).'),
          }),
        )
        .min(1)
        .max(30),
    },
  },
  async ({ items }) =>
    ok(
      brain.addDiscoveredContent(
        items.map(({ catchup, ...i }) => ({ ...i, backfill: catchup })),
        'agent',
      ),
    ),
);

server.registerTool(
  'ingest_sources',
  {
    title: 'Collect new items',
    description:
      'Fetch enabled sources that are due (per cadence) and store new items as pending. Idempotent; per-source failures are reported, not thrown.',
    inputSchema: {
      force: z.boolean().optional().describe('Ignore cadence and fetch all enabled sources.'),
    },
  },
  async ({ force }) => {
    brain.seedInit();
    brain.syncTopicSources();
    const report = await brain.ingestSources({ force });
    return ok({ report, pending: brain.getPulse().pending });
  },
);

// ─── Content ────────────────────────────────────────────────────────────────

server.registerTool(
  'list_pending_content',
  {
    title: 'List items awaiting analysis',
    description:
      'Newest pending items with source excerpt. Triage them: analyze, ignore, or mark duplicate.',
    inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  },
  async ({ limit }) =>
    ok(
      brain
        .listPendingContent(limit ?? 40)
        .map(
          ({ id, sourceName, title, url, author, publishedAt, excerpt, backfill, feedback }) => ({
            id,
            source: sourceName,
            title,
            url,
            author,
            publishedAt,
            excerpt,
            catchup: backfill,
            ...(feedback === 'very_relevant' ? { rescuedByUser: true } : {}),
          }),
        ),
    ),
);

server.registerTool(
  'get_content',
  {
    title: 'Get one item',
    description: 'Full item including source fact and AI layer.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const c = brain.getContent(id);
    return c ? ok(c) : fail(`content ${id} not found`);
  },
);

server.registerTool(
  'list_content',
  {
    title: 'List analyzed items',
    description:
      'Analyzed items ranked by priority then recency. Use for dedup checks and brief generation.',
    inputSchema: {
      area: z.enum(AREAS).optional(),
      sinceHours: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ area, sinceHours, limit }) =>
    ok(
      brain
        .listContent({ area, sinceHours, limit })
        .map(
          ({
            id,
            area,
            category,
            priority,
            title,
            sourceName,
            whyItMatters,
            tags,
            userState,
            feedback,
            publishedAt,
          }) => ({
            id,
            area,
            category,
            priority,
            title,
            source: sourceName,
            whyItMatters,
            tags,
            userState,
            feedback,
            publishedAt,
          }),
        ),
    ),
);

server.registerTool(
  'save_content_analysis',
  {
    title: 'Save analysis for items',
    description:
      'Write the AI layer for one or more pending items (batch up to 20). Marks them analyzed.',
    inputSchema: {
      items: z
        .array(z.object({ id: z.string(), ...analysisSchema }))
        .min(1)
        .max(20),
    },
  },
  async ({ items }) => {
    const saved = items.map(({ id, ...a }) => (brain.saveContentAnalysis(id, a) ? id : null));
    return ok({
      saved: saved.filter(Boolean).length,
      missing: items.filter((_, i) => !saved[i]).map((i) => i.id),
    });
  },
);

server.registerTool(
  'ignore_content',
  {
    title: 'Ignore items',
    description:
      'Mark items as not relevant for this user (P4). The user SEES discarded items and the reason, so give each one a specific one-line reason (what it is + why it is outside their focus), not a generic batch label. Never ignore items with rescuedByUser.',
    inputSchema: {
      items: z
        .array(
          z.object({
            id: z.string(),
            reason: z.string().describe('Specific, one line, in the profile language.'),
          }),
        )
        .min(1)
        .max(100)
        .optional(),
      ids: z
        .array(z.string())
        .min(1)
        .max(100)
        .optional()
        .describe('Legacy: same reason for all — prefer items.'),
      reason: z.string().optional(),
    },
  },
  async ({ items, ids, reason }) => {
    const list = [...(items ?? []), ...(ids ?? []).map((id) => ({ id, reason: reason ?? '' }))];
    let skipped = 0;
    for (const it of list) {
      if (brain.getContent(it.id)?.feedback === 'very_relevant') {
        skipped++;
        continue;
      }
      brain.ignoreContent(it.id, it.reason || null);
    }
    return ok({ ignored: list.length - skipped, skippedRescued: skipped });
  },
);

server.registerTool(
  'mark_duplicate',
  {
    title: 'Mark duplicate',
    description: 'Group an item under another that covers the same event (PTR RF-007).',
    inputSchema: { id: z.string(), duplicateOf: z.string() },
  },
  async ({ id, duplicateOf }) => {
    brain.markDuplicate(id, duplicateOf);
    return ok({ ok: true });
  },
);

server.registerTool(
  'get_feedback',
  {
    title: 'Recent feedback',
    description:
      "User signals (useful / not_useful / not_for_me …) with the item's tags, category and source. Use to recalibrate relevance.",
    inputSchema: { sinceDays: z.number().int().min(1).max(365).optional() },
  },
  async ({ sinceDays }) => ok(brain.listFeedback(sinceDays ?? 30)),
);

// ─── Knowledge, learning, projects ──────────────────────────────────────────

server.registerTool(
  'upsert_knowledge',
  {
    title: 'Add or update a knowledge node',
    description:
      "Create/update a concept on the user's map. Set gapReason to flag a knowledge gap (PTR RF-017); set it to null to clear. Confidence is 0–10 and should only rise with evidence.",
    inputSchema: {
      name: z.string(),
      fullName: z.string().optional(),
      domain: z
        .string()
        .optional()
        .describe('AI, Backend, DevOps, Database, Architecture, Algorithms…'),
      description: z.string().optional(),
      status: z.enum(KNOWLEDGE_STATUSES).optional(),
      confidence: z.number().int().min(0).max(10).optional(),
      related: z.array(z.string()).optional(),
      nextStep: z.string().nullable().optional(),
      gapReason: z.string().nullable().optional(),
      evidence: z
        .array(
          z.object({
            kind: z.enum(['studied', 'exercise', 'applied', 'project', 'tutorial', 'used', 'seen']),
            note: z.string(),
          }),
        )
        .optional()
        .describe('Appended, never replaced.'),
    },
  },
  async ({ evidence, ...k }) => {
    const at = new Date().toISOString();
    return ok(brain.upsertKnowledge({ ...k, evidence: evidence?.map((e) => ({ ...e, at })) }));
  },
);

server.registerTool(
  'upsert_learning_item',
  {
    title: 'Queue a learning session',
    description:
      "Add/update an item in 'Continuar aprendendo'. Default session is the 15-min 5-step format (Conceito, Exemplo, Código, Exercício, Verificar).",
    inputSchema: {
      id: z.string().optional(),
      title: z.string().describe('Concept name — should match a knowledge node.'),
      track: z.string().optional().describe("Uppercase track label, e.g. 'AI AGENTS'."),
      why: z.string().optional(),
      sourceContentId: z.string().optional(),
      steps: z.array(z.object({ name: z.string(), minutes: z.number().int().min(1) })).optional(),
    },
  },
  async (args) => ok(brain.upsertLearning(args)),
);

server.registerTool(
  'list_lessons_to_write',
  {
    title: 'Lessons without content',
    description:
      'Learning items that only have an outline (step names). Write each with write_lesson — the user opens them in Learn to study.',
    inputSchema: {},
  },
  async () =>
    ok(
      brain.listUnwrittenLearning().map((l) => ({
        id: l.id,
        title: l.title,
        track: l.track,
        why: l.why,
        steps: l.steps.map((s) => ({ name: s.name, minutes: s.minutes })),
        readings: brain
          .learningReadings(l)
          .contents.map(({ id, title, url }) => ({ id, title, url })),
      })),
    ),
);

const quizSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(5),
  answer: z.number().int().min(0).describe('Index of the correct option.'),
  explanation: z.string().describe('Why the right answer is right (and the wrong ones wrong).'),
});

server.registerTool(
  'write_lesson',
  {
    title: 'Write a lesson',
    description: [
      'Write the full content of a learning item so the user can study it inside the app (Learn → aula).',
      'Ground everything in sources you actually read (WebFetch official docs, the related content, papers); cite them in `sources`.',
      'Write in the profile language, didactic and direct, for THIS user (reference their stack and projects).',
      'Typical structure (5 steps, ~15 min): concept (Markdown body, 150–400 words, analogy, small diagram in a text code block if useful) →',
      "example (a real case, ideally from the related content) → code (runnable snippet in the user's stack: code.language + code.source, explained in body) →",
      'exercise (a prompt tied to their project; they answer in the app) → quiz (3 multiple-choice questions with explanations).',
      "Replaces the steps; keeps the user's progress and answers.",
    ].join(' '),
    inputSchema: {
      id: z.string(),
      why: z.string().optional().describe('One line: why study this now.'),
      steps: z
        .array(
          z.object({
            name: z.string(),
            minutes: z.number().int().min(1).max(30),
            kind: z.enum(['concept', 'example', 'code', 'exercise', 'quiz', 'reading']),
            body: z
              .string()
              .describe('Markdown: ### headings, lists, **bold**, `inline code`, tables, links.'),
            code: z
              .object({ language: z.string(), source: z.string(), caption: z.string().optional() })
              .optional(),
            exercise: z.string().optional(),
            quiz: z.array(quizSchema).max(5).optional(),
          }),
        )
        .min(3)
        .max(8),
      sources: z
        .array(z.object({ title: z.string(), url: z.string().url() }))
        .min(1)
        .max(10),
    },
  },
  async ({ id, why, steps, sources }) => {
    const l = brain.getLearning(id);
    if (!l) return fail(`learning item ${id} not found`);
    const prev = new Map(l.steps.map((s) => [s.name, s]));
    const merged = steps.map((s) => ({
      ...s,
      answer: prev.get(s.name)?.answer,
      answeredAt: prev.get(s.name)?.answeredAt,
      feedback: prev.get(s.name)?.feedback,
    }));
    const item = brain.upsertLearning({
      ...l,
      why: why ?? l.why,
      steps: merged,
      sources,
      writtenAt: new Date().toISOString(),
      stepsDone: Math.min(l.stepsDone, merged.length),
      minutesTotal: merged.reduce((a, s) => a + s.minutes, 0),
    });
    return ok({ id: item.id, steps: item.steps.length, minutes: item.minutesTotal });
  },
);

server.registerTool(
  'list_answers_to_review',
  {
    title: 'Exercise answers to review',
    description: 'Answers the user wrote in lesson exercises that have no feedback yet.',
    inputSchema: {},
  },
  async () => ok(brain.listPendingReviews()),
);

server.registerTool(
  'review_answer',
  {
    title: 'Review an exercise answer',
    description:
      "Short, specific feedback on the user's answer (what is right, what is missing, one next step). Shown under the exercise. If the answer shows real understanding, also add evidence with upsert_knowledge (kind: exercise).",
    inputSchema: { id: z.string(), index: z.number().int().min(0), feedback: z.string() },
  },
  async ({ id, index, feedback }) => {
    const l = brain.getLearning(id);
    if (!l?.steps[index]) return fail('step not found');
    brain.upsertLearning({
      ...l,
      steps: l.steps.map((s, i) => (i === index ? { ...s, feedback } : s)),
    });
    return ok({ ok: true });
  },
);

server.registerTool(
  'upsert_learning_path',
  {
    title: 'Create or update a learning path',
    description:
      'Ordered modules toward a goal (PTR RF-018). Module status: done | current | gap | todo. Never put advanced modules before unmet fundamentals. Pass goalId when the path answers a user goal. Returns the path id.',
    inputSchema: {
      goalId: z.string().optional(),
      name: z.string(),
      goal: z.string().optional(),
      modules: z.array(
        z.object({ title: z.string(), status: z.enum(['done', 'current', 'gap', 'todo']) }),
      ),
    },
  },
  async (args) => ok(brain.upsertLearningPath(args)),
);

const taskSchema = z.object({ title: z.string(), status: z.enum(TASK_STATUSES) });

server.registerTool(
  'suggest_project',
  {
    title: 'Suggest a project',
    description:
      "Propose a 'Construa com isto' project built from recent content + user knowledge (PTR RF-020). Shown as an AI suggestion; the user compares all pending suggestions and picks one (or rejects). Read get_context.rejectedProjects first: never re-suggest something the user rejected, and learn from the reasons.",
    inputSchema: {
      name: z.string(),
      goal: z.string(),
      reason: z.string().describe('Why now: which content / gap motivates it.'),
      difficulty: z.enum(['Iniciante', 'Intermediário', 'Avançado']),
      estimatedTime: z.string().describe("e.g. '2h 30m'"),
      technologies: z.array(z.string()),
      prerequisites: z.array(z.object({ name: z.string(), known: z.boolean() })),
      tasks: z.array(z.string()).min(2).max(12),
      sourceContentId: z.string().optional(),
    },
  },
  async ({ tasks, ...p }) =>
    ok(
      brain.upsertProject({
        ...p,
        status: 'IDEA',
        aiSuggested: true,
        tasks: tasks.map((title) => ({ title, status: 'TODO' as const })),
      }),
    ),
);

server.registerTool(
  'update_project',
  {
    title: 'Update a project',
    description: 'Update status, tasks or prerequisites of an existing project.',
    inputSchema: {
      id: z.string(),
      name: z.string().optional(),
      goal: z.string().optional(),
      status: z.enum(PROJECT_STATUSES).optional(),
      tasks: z.array(taskSchema).optional(),
      prerequisites: z.array(z.object({ name: z.string(), known: z.boolean() })).optional(),
      technologies: z.array(z.string()).optional(),
    },
  },
  async ({ id, ...patch }) => {
    const p = brain.getProject(id);
    return p
      ? ok(brain.upsertProject({ ...p, ...patch, name: patch.name ?? p.name }))
      : fail(`project ${id} not found`);
  },
);

server.registerTool(
  'add_build_watch',
  {
    title: 'Add a Build Watch event',
    description:
      "Record an update on a public project worth watching (PTR RF-022). Changes use '+' added, '-' removed, '~' changed.",
    inputSchema: {
      project: z.string(),
      author: z.string().optional(),
      url: z.string().url(),
      changes: z
        .array(z.object({ sign: z.enum(['+', '-', '~']), text: z.string() }))
        .min(1)
        .max(6),
      technologies: z.array(z.string()),
      why: z.string().describe('Why watching this helps the user.'),
      happenedAt: z.string().optional().describe('ISO date of the change.'),
    },
  },
  async (args) => ok(brain.addBuildWatch({ ...args, author: args.author ?? null })),
);

// ─── Goals & study plan ─────────────────────────────────────────────────────

server.registerTool(
  'list_goals',
  {
    title: 'List learning goals',
    description:
      "Goals the user described in their own words. 'new' goals need a plan: learning path + resources + learning items.",
    inputSchema: { includeDone: z.boolean().optional() },
  },
  async ({ includeDone }) =>
    ok(
      brain
        .listGoals({
          status: includeDone
            ? ['new', 'planning', 'active', 'done']
            : ['new', 'planning', 'active'],
        })
        .map((g) => ({
          ...g,
          resources: brain.listResources({ goalId: g.id }).length,
        })),
    ),
);

server.registerTool(
  'create_goal',
  {
    title: 'Create a learning goal',
    description:
      "Register a goal the user described in the conversation (e.g. 'quero aprender Rust para CLIs').",
    inputSchema: { text: z.string().min(3) },
  },
  async ({ text }) => ok(brain.createGoal(text)),
);

server.registerTool(
  'update_goal',
  {
    title: 'Update a goal',
    description:
      'Link the goal to its learning path, set status (planning → active → done) and leave a short note on the plan.',
    inputSchema: {
      id: z.string(),
      status: z.enum(GOAL_STATUSES).optional(),
      pathId: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ id, ...patch }) => {
    const g = brain.updateGoal(id, patch);
    return g ? ok(g) : fail(`goal ${id} not found`);
  },
);

server.registerTool(
  'add_learning_resources',
  {
    title: 'Attach study resources',
    description:
      'Attach curated material to a goal / path module: videos (YouTube), tutorials, courses, official docs, articles, books, papers, repos, exercises. Only real URLs you verified. Prefer free, recent, high-quality; mix formats; note language (pt/en).',
    inputSchema: {
      items: z
        .array(
          z.object({
            goalId: z.string().optional(),
            pathId: z.string().optional(),
            module: z
              .string()
              .optional()
              .describe('Path module / knowledge name this resource teaches.'),
            kind: z.enum(RESOURCE_KINDS),
            title: z.string(),
            url: z.string().url(),
            author: z.string().optional(),
            minutes: z.number().int().min(1).optional(),
            level: z.enum(['iniciante', 'intermediário', 'avançado']).optional(),
            language: z.string().optional().describe('pt, en…'),
            why: z.string().optional().describe('One line: why this resource, for this user.'),
          }),
        )
        .min(1)
        .max(30),
    },
  },
  async ({ items }) =>
    ok(
      brain.addResources(
        items.map((i) => ({
          goalId: i.goalId ?? null,
          pathId: i.pathId ?? null,
          module: i.module ?? null,
          kind: i.kind,
          title: i.title,
          url: i.url,
          author: i.author ?? null,
          minutes: i.minutes ?? null,
          level: i.level ?? null,
          language: i.language ?? null,
          why: i.why ?? null,
        })),
      ),
    ),
);

// ─── People (Pessoas) ───────────────────────────────────────────────────────

server.registerTool(
  'list_creators',
  {
    title: 'People the user follows',
    description:
      "Tech news presenters / builders with their channels (YouTube, Instagram, TikTok, X, Bluesky, blogs…). Channels with kind 'social' have no feed: find their new posts with WebSearch (e.g. 'site:tiktok.com/@handle', '<name> instagram reel <topic>') and add them via add_discovered_content with creatorId.",
    inputSchema: { includeSuggested: z.boolean().optional() },
  },
  async ({ includeSuggested }) =>
    ok(
      brain.listCreators({ status: includeSuggested ? ['following', 'suggested'] : ['following'] }),
    ),
);

server.registerTool(
  'add_creator',
  {
    title: 'Follow a person',
    description:
      'Follow someone across platforms. Pass every profile link you verified; each becomes a channel.',
    inputSchema: {
      name: z.string(),
      links: z.array(z.string().url()).min(1).max(10),
      bio: z.string().optional().describe('One line: what they cover.'),
      topics: z.array(z.string()).optional(),
    },
  },
  async (args) => ok(await brain.addCreator({ ...args, status: 'following' })),
);

server.registerTool(
  'suggest_creator',
  {
    title: 'Suggest a person to follow',
    description:
      "Suggest a tech news presenter/builder that matches the user's stack and interests. Only real, active people with verified profile links. The user accepts or ignores it in Pessoas. Max ~3 per week.",
    inputSchema: {
      name: z.string(),
      links: z.array(z.string().url()).min(1).max(10),
      bio: z.string().describe('What they cover and in which language.'),
      reason: z.string().describe('Why they are a good fit for this user.'),
      topics: z.array(z.string()).optional(),
    },
  },
  async (args) => ok(await brain.addCreator({ ...args, status: 'suggested' })),
);

server.registerTool(
  'list_creator_posts',
  {
    title: 'Recent posts from followed people',
    description: 'Latest items from people the user follows (analyzed or pending), newest first.',
    inputSchema: {
      days: z.number().int().min(1).max(90).optional(),
      creatorId: z.string().optional(),
    },
  },
  async ({ days, creatorId }) => ok(brain.listCreatorPosts({ days, creatorId, limit: 80 })),
);

// ─── GitHub em alta ─────────────────────────────────────────────────────────

server.registerTool(
  'list_trending_repos',
  {
    title: 'Projects gaining stars',
    description:
      'Repos from GitHub trending, new repos with many stars, and repos linked in content/posts (with who posted them). gained7d = stars gained in 7 days (measured from daily snapshots). Annotate the relevant ones with annotate_repo.',
    inputSchema: {
      scope: z
        .enum(['all', 'stack', 'posted'])
        .optional()
        .describe(
          "stack = matches the user's technologies/interests; posted = linked by people they follow",
        ),
      sort: z.enum(['gained', 'stars', 'new']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ scope, sort, limit }) =>
    ok(
      brain.listTrendingRepos({ scope, sort, limit: limit ?? 30 }).map(({ history, ...r }) => ({
        ...r,
        mentions: r.mentions.slice(0, 3),
        days: history.length,
      })),
    ),
);

server.registerTool(
  'annotate_repo',
  {
    title: 'Explain why a repo matters',
    description:
      "AI layer for a trending repo: one or two sentences tying it to the user's stack/projects. Shown on 'GitHub em alta'.",
    inputSchema: { fullName: z.string(), whyItMatters: z.string() },
  },
  async ({ fullName, whyItMatters }) => {
    brain.annotateRepo(fullName, whyItMatters);
    return ok({ ok: true });
  },
);

server.registerTool(
  'track_repos',
  {
    title: 'Track repos',
    description: 'Start tracking star growth of repos you found (owner/name or GitHub URLs).',
    inputSchema: { repos: z.array(z.string()).min(1).max(50) },
  },
  async ({ repos }) => ok(brain.trackRepos(repos)),
);

// ─── Catch-up ───────────────────────────────────────────────────────────────

server.registerTool(
  'backfill_history',
  {
    title: 'Collect history for catch-up',
    description:
      "Pull the last N months (default 24) for the user's technologies/topics: major/minor GitHub releases of the official repos and the most-discussed HN stories. Items enter as pending with catchup=true and stay out of the daily Now feed.",
    inputSchema: {
      months: z.number().int().min(1).max(36).optional(),
      topics: z
        .array(z.string())
        .optional()
        .describe('Defaults to profile technologies + high/medium interests.'),
    },
  },
  async ({ months, topics }) => ok(await brain.backfillHistory({ months, topics })),
);

server.registerTool(
  'add_milestones',
  {
    title: 'Write catch-up milestones',
    description:
      "The 'what you missed' timeline per technology: one entry per change that matters (major release, new paradigm, deprecation, breaking change, security incident, ecosystem shift). Upserts by (topic, title), keeping the user's state.",
    inputSchema: {
      items: z
        .array(
          z.object({
            topic: z
              .string()
              .describe("Technology/topic name exactly as in the profile, e.g. 'Next.js'."),
            happenedAt: z
              .string()
              .regex(/^\d{4}-\d{2}(-\d{2})?$/)
              .describe('YYYY-MM-DD or YYYY-MM'),
            title: z.string().describe("Short: 'Next.js 15: React 19 e cache opt-in'"),
            summary: z.string().describe('2–3 factual sentences: what changed.'),
            why: z
              .string()
              .optional()
              .describe('Why it matters for this user (their projects/stack).'),
            importance: z
              .enum(MILESTONE_IMPORTANCE)
              .describe(
                'essential = you must know to be current; important = worth knowing; nice = context.',
              ),
            links: z
              .array(z.object({ title: z.string(), url: z.string().url() }))
              .max(4)
              .describe('Primary sources: release notes, official blog, docs.'),
            contentId: z
              .string()
              .optional()
              .describe('Catch-up content item this milestone came from.'),
          }),
        )
        .min(1)
        .max(40),
    },
  },
  async ({ items }) =>
    ok(
      brain.addMilestones(
        items.map((m) => ({
          ...m,
          happenedAt: m.happenedAt.length === 7 ? `${m.happenedAt}-01` : m.happenedAt,
          why: m.why ?? null,
          contentId: m.contentId ?? null,
        })),
      ),
    ),
);

server.registerTool(
  'list_milestones',
  {
    title: 'List catch-up milestones',
    description: 'Existing timeline (to avoid duplicates) and how caught-up the user is per topic.',
    inputSchema: {
      months: z.number().int().min(1).max(36).optional(),
      topic: z.string().optional(),
    },
  },
  async ({ months, topic }) =>
    ok({
      progress: brain.catchupProgress(months ?? 24),
      milestones: brain
        .listMilestones({ months, topic })
        .map(({ id, topic, happenedAt, title, importance, state }) => ({
          id,
          topic,
          happenedAt,
          title,
          importance,
          state,
        })),
    }),
);

// ─── Briefs ─────────────────────────────────────────────────────────────────

server.registerTool(
  'publish_brief',
  {
    title: 'Publish the daily or weekly brief',
    description:
      'Write the editorial brief (PTR RF-023/024). itemIds = the top 3 analyzed items, in order. blocks = one each for learn, build, watch, frontier. Fits profile.minutesPerDay.',
    inputSchema: {
      type: z.enum(['daily', 'weekly']),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      headline: z
        .string()
        .describe(
          "Two short lines separated by \\n, e.g. 'Bom dia.\\nIsto mudou enquanto você estava fora.'",
        ),
      intro: z.string().optional(),
      itemIds: z.array(z.string()).max(5),
      blocks: z
        .array(
          z.object({
            kind: z.enum(['important', 'learn', 'build', 'watch', 'frontier']),
            label: z.string().describe("Uppercase mono label, e.g. 'LEARN · 20 MIN'."),
            title: z.string(),
            meta: z.string().optional(),
            contentId: z.string().optional(),
          }),
        )
        .max(6),
      nextMove: z
        .object({
          title: z.string(),
          action: z.string(),
          href: z.string().describe('App route, e.g. /learn'),
        })
        .optional(),
      stats: z
        .record(z.string(), z.number())
        .optional()
        .describe('e.g. { analyzed, relevant, minutes }'),
    },
  },
  async ({ date, stats, nextMove, intro, ...b }) =>
    ok(
      brain.saveBrief({
        ...b,
        date: date ?? new Date().toISOString().slice(0, 10),
        stats: stats ?? {},
        nextMove: nextMove ?? null,
        intro: intro ?? null,
      }),
    ),
);

// ─── Search & observability ─────────────────────────────────────────────────

server.registerTool(
  'search',
  {
    title: 'Search the brain',
    description: 'Keyword search over knowledge, projects, learning and analyzed content.',
    inputSchema: { q: z.string() },
  },
  async ({ q }) => ok(brain.search(q)),
);

server.registerTool(
  'start_run',
  {
    title: 'Start an agent run',
    description: 'Call at the start of a scheduled task; returns runId.',
    inputSchema: { task: z.string() },
  },
  async ({ task }) => ok(brain.startAgentRun(task)),
);

server.registerTool(
  'finish_run',
  {
    title: 'Finish an agent run',
    description:
      'Close the run with a one-line summary and counters (analyzed, ignored, duplicates, gaps, …). Shown in the app header and Settings.',
    inputSchema: {
      runId: z.string(),
      summary: z.string(),
      stats: z.record(z.string(), z.number()).optional(),
    },
  },
  async ({ runId, summary, stats }) => {
    brain.finishAgentRun(runId, summary, stats ?? {});
    return ok({ ok: true });
  },
);

server.registerTool(
  'record_feedback',
  {
    title: 'Record feedback',
    description: 'Record a user signal on an item (normally done from the UI).',
    inputSchema: { id: z.string(), signal: z.enum(FEEDBACK_SIGNALS) },
  },
  async ({ id, signal }) => {
    brain.addFeedback(id, signal);
    return ok({ ok: true });
  },
);

const session = roles.finalize();
process.stderr
  .write(`[current-brain] roles=${session.roles.join(',')} tools=${session.tools} schema≈${Math.round(session.bytes / 1024)}KB
`);

await server.connect(new StdioServerTransport());
