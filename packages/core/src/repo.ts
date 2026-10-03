import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import type {
  AgentRun,
  Area,
  Brief,
  BuildWatchUpdate,
  Goal,
  LearningResource,
  Milestone,
  MilestoneState,
  Content,
  ContentAnalysis,
  FeedbackSignal,
  Knowledge,
  LearningItem,
  LearningPath,
  Profile,
  Project,
  Source,
  UserState,
} from './types';

type Row = Record<string, any>;
type Params = Record<string, string | number | null>;

const now = () => new Date().toISOString();
const json = (v: unknown) => JSON.stringify(v ?? null);
const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return (JSON.parse(v) as T) ?? fallback;
  } catch {
    return fallback;
  }
};
const all = (sql: string, p: Params = {}) => getDb().prepare(sql).all(p) as Row[];
const one = (sql: string, p: Params = {}) => getDb().prepare(sql).get(p) as Row | undefined;
const run = (sql: string, p: Params = {}) => getDb().prepare(sql).run(p);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ─── Profile ────────────────────────────────────────────────────────────────

export const DEFAULT_PROFILE: Profile = {
  onboarded: false,
  name: 'Nomade',
  role: 'Backend + IA',
  becoming: ['Engenheiro de IA'],
  technologies: ['Python', 'TypeScript', 'Node.js', 'PostgreSQL'],
  building: ['Um assistente de IA'],
  interests: [
    { name: 'AI Agents', priority: 'high' },
    { name: 'RAG', priority: 'high' },
    { name: 'Local AI', priority: 'medium' },
    { name: 'Open Source', priority: 'medium' },
  ],
  minutesPerDay: 20,
  limits: { now: 5, learn: 2, build: 1, frontier: 3 },
  language: 'pt-BR',
  rsshubUrl: null,
};

export function getProfile(): Profile {
  const stored = parse<Omit<Partial<Profile>, 'becoming'> & { becoming?: string | string[] }>(
    one('SELECT data FROM profile WHERE id = 1')?.data,
    {},
  );
  const becoming =
    typeof stored.becoming === 'string'
      ? [stored.becoming]
      : (stored.becoming ?? DEFAULT_PROFILE.becoming);
  return {
    ...DEFAULT_PROFILE,
    ...stored,
    becoming,
    limits: { ...DEFAULT_PROFILE.limits, ...stored.limits },
  };
}

export function saveProfile(patch: Partial<Profile>): Profile {
  const next = { ...getProfile(), ...patch };
  run(
    'INSERT INTO profile (id, data) VALUES (1, :data) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    { data: json(next) },
  );
  return next;
}

// ─── Sources ────────────────────────────────────────────────────────────────

const toSource = (r: Row): Source => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  url: r.url,
  defaultArea: r.default_area,
  everyMinutes: r.every_minutes,
  origin: r.origin ?? 'default',
  topic: r.topic ?? null,
  platform: r.platform ?? null,
  creatorId: r.creator_id ?? null,
  enabled: !!r.enabled,
  lastFetchedAt: r.last_fetched_at,
  lastError: r.last_error,
});

export function listSources(opts: { enabledOnly?: boolean } = {}): Source[] {
  return all(
    `SELECT * FROM sources ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY name`,
  ).map(toSource);
}

export function upsertSource(s: Pick<Source, 'kind' | 'name' | 'url'> & Partial<Source>): Source {
  const existing = one('SELECT * FROM sources WHERE id = :id OR url = :url', {
    id: s.id ?? '',
    url: s.url,
  });
  const prev = existing ? toSource(existing) : null;
  const id = prev?.id ?? randomUUID();
  run(
    `INSERT INTO sources (id, kind, name, url, default_area, every_minutes, origin, topic, platform, creator_id, enabled)
     VALUES (:id, :kind, :name, :url, :area, :every, :origin, :topic, :platform, :creatorId, :enabled)
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, url = excluded.url,
       default_area = excluded.default_area, every_minutes = excluded.every_minutes, origin = excluded.origin,
       topic = excluded.topic, platform = excluded.platform, creator_id = excluded.creator_id, enabled = excluded.enabled`,
    {
      id,
      kind: s.kind,
      name: s.name,
      url: s.url,
      area: s.defaultArea ?? prev?.defaultArea ?? null,
      every: s.everyMinutes ?? prev?.everyMinutes ?? 60,
      origin: s.origin ?? prev?.origin ?? 'user',
      topic: s.topic ?? prev?.topic ?? null,
      platform: s.platform ?? prev?.platform ?? null,
      creatorId: s.creatorId ?? prev?.creatorId ?? null,
      enabled: (s.enabled ?? prev?.enabled ?? true) ? 1 : 0,
    },
  );
  return toSource(one('SELECT * FROM sources WHERE id = :id', { id })!);
}

export function setSourceEnabled(id: string, enabled: boolean): void {
  run('UPDATE sources SET enabled = :e WHERE id = :id', { id, e: enabled ? 1 : 0 });
}

export function markSourceFetched(id: string, error: string | null): void {
  run('UPDATE sources SET last_fetched_at = :at, last_error = :err WHERE id = :id', {
    id,
    at: now(),
    err: error,
  });
}

// ─── Content ────────────────────────────────────────────────────────────────

const CONTENT_SELECT = `SELECT c.*, s.name AS source_name FROM contents c LEFT JOIN sources s ON s.id = c.source_id`;

const toContent = (r: Row): Content => ({
  id: r.id,
  sourceId: r.source_id,
  sourceName: r.source_name ?? 'Desconhecida',
  externalId: r.external_id,
  url: r.url,
  title: r.title,
  author: r.author,
  publishedAt: r.published_at,
  retrievedAt: r.retrieved_at,
  excerpt: r.excerpt,
  status: r.status,
  duplicateOf: r.duplicate_of,
  area: r.area,
  category: r.category,
  summary: r.summary,
  whyItMatters: r.why_it_matters,
  keyPoints: parse(r.key_points, []),
  explain: parse(r.explain, {}),
  tags: parse(r.tags, []),
  priority: r.priority,
  readMinutes: r.read_minutes,
  relatedKnowledge: parse(r.related_knowledge, []),
  learnTopic: r.learn_topic,
  maturity: r.maturity,
  signals: r.signals,
  analyzedAt: r.analyzed_at,
  backfill: !!r.backfill,
  creatorId: r.creator_id ?? null,
  userState: r.user_state,
  feedback: r.feedback,
});

export interface RawItem {
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  author?: string | null;
  publishedAt?: string | null;
  excerpt?: string | null;
  backfill?: boolean;
  /** Defaults to the source's person. */
  creatorId?: string | null;
}

/** Idempotent (PTR RNF-007): re-ingesting the same item is a no-op. */
export function insertRawContent(items: RawItem[]): { inserted: number; skipped: number } {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO contents (id, source_id, external_id, url, title, author, published_at, retrieved_at, excerpt, backfill, creator_id)
     VALUES (:id, :sourceId, :externalId, :url, :title, :author, :publishedAt, :retrievedAt, :excerpt, :backfill,
       COALESCE(:creatorId, (SELECT creator_id FROM sources WHERE id = :sourceId)))`,
  );
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const it of items) {
      inserted += Number(
        stmt.run({
          id: randomUUID(),
          sourceId: it.sourceId,
          externalId: it.externalId,
          url: it.url,
          title: it.title,
          author: it.author ?? null,
          publishedAt: it.publishedAt ?? null,
          retrievedAt: now(),
          excerpt: it.excerpt ?? null,
          backfill: it.backfill ? 1 : 0,
          creatorId: it.creatorId ?? null,
        }).changes,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { inserted, skipped: items.length - inserted };
}

export interface ContentQuery {
  area?: Area;
  status?: Content['status'];
  userState?: UserState;
  category?: string;
  tag?: string;
  sinceHours?: number;
  limit?: number;
  /** Catch-up history is excluded from the daily flow unless asked for. */
  backfill?: 'exclude' | 'include' | 'only';
}

const PRIORITY_ORDER = `CASE c.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END`;

export function listContent(q: ContentQuery = {}): Content[] {
  const where = ['c.status = :status'];
  const p: Params = { status: q.status ?? 'analyzed', limit: q.limit ?? 50 };
  if (q.area) (where.push('c.area = :area'), (p.area = q.area));
  if ((q.backfill ?? 'exclude') === 'exclude') where.push('c.backfill = 0');
  if (q.backfill === 'only') where.push('c.backfill = 1');
  if (q.userState) (where.push('c.user_state = :us'), (p.us = q.userState));
  else if (p.status === 'analyzed') where.push("c.user_state != 'IGNORED'");
  if (q.category) (where.push('c.category = :cat'), (p.cat = q.category));
  if (q.tag)
    (where.push('EXISTS (SELECT 1 FROM json_each(c.tags) WHERE lower(value) = lower(:tag))'),
      (p.tag = q.tag));
  if (q.sinceHours) {
    where.push('COALESCE(c.published_at, c.retrieved_at) >= :since');
    p.since = new Date(Date.now() - q.sinceHours * 3600_000).toISOString();
  }
  return all(
    `${CONTENT_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY ${PRIORITY_ORDER}, COALESCE(c.published_at, c.retrieved_at) DESC LIMIT :limit`,
    p,
  ).map(toContent);
}

export function listPendingContent(limit = 25): Content[] {
  // Items the user rescued ("é relevante") first.
  return all(
    `${CONTENT_SELECT} WHERE c.status = 'pending' ORDER BY (c.feedback = 'very_relevant') DESC, COALESCE(c.published_at, c.retrieved_at) DESC LIMIT :limit`,
    { limit },
  ).map(toContent);
}

export function getContent(id: string): Content | null {
  const r = one(`${CONTENT_SELECT} WHERE c.id = :id`, { id });
  return r ? toContent(r) : null;
}

export function saveContentAnalysis(id: string, a: ContentAnalysis): Content | null {
  run(
    `UPDATE contents SET status = 'analyzed', area = :area, category = :category, summary = :summary,
      why_it_matters = :why, key_points = :kp, explain = :explain, tags = :tags, priority = :priority,
      read_minutes = :rm, related_knowledge = :rk, learn_topic = :lt, maturity = :mat, signals = :sig, analyzed_at = :at
     WHERE id = :id`,
    {
      id,
      area: a.area,
      category: a.category,
      summary: a.summary,
      why: a.whyItMatters,
      kp: json(a.keyPoints),
      explain: json(a.explain ?? {}),
      tags: json(a.tags.map((t) => t.toUpperCase())),
      priority: a.priority,
      rm: a.readMinutes,
      rk: json(a.relatedKnowledge ?? []),
      lt: a.learnTopic ?? null,
      mat: a.maturity == null ? null : clamp(a.maturity, 1, 5),
      sig: a.signals ?? null,
      at: now(),
    },
  );
  return getContent(id);
}

export function ignoreContent(id: string, reason: string | null = null): void {
  run(
    "UPDATE contents SET status = 'ignored', priority = 'P4', why_it_matters = :reason, analyzed_at = :at WHERE id = :id",
    { id, reason, at: now() },
  );
}

export function markDuplicate(id: string, of: string): void {
  run(
    "UPDATE contents SET status = 'duplicate', duplicate_of = :of, analyzed_at = :at WHERE id = :id",
    { id, of, at: now() },
  );
}

export function setUserState(id: string, state: UserState): void {
  run('UPDATE contents SET user_state = :state WHERE id = :id', { id, state });
}

export function toggleSaved(id: string): boolean {
  const c = getContent(id);
  if (!c) return false;
  const saved = c.userState !== 'SAVED';
  setUserState(id, saved ? 'SAVED' : 'READ');
  return saved;
}

export function addFeedback(contentId: string, signal: FeedbackSignal): void {
  run('INSERT INTO feedback (content_id, signal, created_at) VALUES (:contentId, :signal, :at)', {
    contentId,
    signal,
    at: now(),
  });
  run('UPDATE contents SET feedback = :signal WHERE id = :contentId', { contentId, signal });
}

export function listFeedback(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  return all(
    `SELECT f.signal, f.created_at AS at, c.title, c.tags, c.category, c.area, s.name AS source
     FROM feedback f JOIN contents c ON c.id = f.content_id LEFT JOIN sources s ON s.id = c.source_id
     WHERE f.created_at >= :since ORDER BY f.created_at DESC`,
    { since },
  ).map((r) => ({ ...r, tags: parse(r.tags, []) }));
}

// ─── Knowledge ──────────────────────────────────────────────────────────────

const toKnowledge = (r: Row): Knowledge => ({
  id: r.id,
  name: r.name,
  fullName: r.full_name,
  domain: r.domain,
  description: r.description,
  status: r.status,
  confidence: r.confidence,
  related: parse(r.related, []),
  evidence: parse(r.evidence, []),
  nextStep: r.next_step,
  gapReason: r.gap_reason,
  pos: parse(r.pos, null),
  createdAt: r.created_at,
  lastReviewed: r.last_reviewed,
});

export function listKnowledge(): Knowledge[] {
  return all('SELECT * FROM knowledge ORDER BY confidence DESC, name').map(toKnowledge);
}

export function listGaps(): Knowledge[] {
  return all(
    "SELECT * FROM knowledge WHERE gap_reason IS NOT NULL AND status IN ('DISCOVERED','LEARNING') ORDER BY created_at DESC",
  ).map(toKnowledge);
}

export function getKnowledgeByName(name: string): Knowledge | null {
  const r = one('SELECT * FROM knowledge WHERE name = :name', { name });
  return r ? toKnowledge(r) : null;
}

export function upsertKnowledge(k: Partial<Knowledge> & { name: string }): Knowledge {
  const prev = getKnowledgeByName(k.name);
  const next: Knowledge = {
    id: prev?.id ?? randomUUID(),
    name: prev?.name ?? k.name,
    fullName: k.fullName ?? prev?.fullName ?? null,
    domain: k.domain ?? prev?.domain ?? 'Geral',
    description: k.description ?? prev?.description ?? null,
    status: k.status ?? prev?.status ?? 'DISCOVERED',
    confidence: clamp(Math.round(k.confidence ?? prev?.confidence ?? 0), 0, 10),
    related: k.related ?? prev?.related ?? [],
    evidence: [...(prev?.evidence ?? []), ...(k.evidence ?? [])],
    nextStep: k.nextStep !== undefined ? k.nextStep : (prev?.nextStep ?? null),
    gapReason: k.gapReason !== undefined ? k.gapReason : (prev?.gapReason ?? null),
    pos: k.pos !== undefined ? k.pos : (prev?.pos ?? null),
    createdAt: prev?.createdAt ?? now(),
    lastReviewed: k.lastReviewed ?? prev?.lastReviewed ?? null,
  };
  run(
    `INSERT INTO knowledge (id, name, full_name, domain, description, status, confidence, related, evidence, next_step, gap_reason, pos, created_at, last_reviewed)
     VALUES (:id, :name, :fullName, :domain, :description, :status, :confidence, :related, :evidence, :nextStep, :gapReason, :pos, :createdAt, :lastReviewed)
     ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, domain = excluded.domain,
       description = excluded.description, status = excluded.status, confidence = excluded.confidence,
       related = excluded.related, evidence = excluded.evidence, next_step = excluded.next_step,
       gap_reason = excluded.gap_reason, pos = excluded.pos, last_reviewed = excluded.last_reviewed`,
    {
      ...next,
      related: json(next.related),
      evidence: json(next.evidence),
      pos: next.pos ? json(next.pos) : null,
    },
  );
  return next;
}

// ─── Projects ───────────────────────────────────────────────────────────────

const toProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  goal: r.goal,
  status: r.status,
  difficulty: r.difficulty,
  estimatedTime: r.estimated_time,
  technologies: parse(r.technologies, []),
  prerequisites: parse(r.prerequisites, []),
  tasks: parse(r.tasks, []),
  aiSuggested: !!r.ai_suggested,
  reason: r.reason,
  rejection: r.rejection ?? null,
  rejectedAt: r.rejected_at ?? null,
  sourceContentId: r.source_content_id,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

/** DONE counts 1, IN_PROGRESS counts ½ — same rule as the design. */
export function projectProgress(p: Pick<Project, 'tasks'>): number {
  if (!p.tasks.length) return 0;
  const v = p.tasks.reduce(
    (a, t) => a + (t.status === 'DONE' ? 1 : t.status === 'IN_PROGRESS' ? 0.5 : 0),
    0,
  );
  return Math.round((v / p.tasks.length) * 100);
}

export function listProjects(opts: { includeSuggested?: boolean } = {}): Project[] {
  return all(
    `SELECT * FROM projects ${opts.includeSuggested ? '' : 'WHERE ai_suggested = 0'}
     ORDER BY CASE status WHEN 'BUILDING' THEN 0 WHEN 'PLANNED' THEN 1 WHEN 'IDEA' THEN 2 WHEN 'PAUSED' THEN 3 WHEN 'COMPLETED' THEN 4 ELSE 5 END, created_at DESC`,
  ).map(toProject);
}

export function getSuggestedProject(): Project | null {
  const r = one(
    "SELECT * FROM projects WHERE ai_suggested = 1 AND status != 'ARCHIVED' ORDER BY created_at DESC LIMIT 1",
  );
  return r ? toProject(r) : null;
}

/** All pending AI suggestions — the user compares them and picks one. */
export function listSuggestedProjects(): Project[] {
  return all(
    "SELECT * FROM projects WHERE ai_suggested = 1 AND status != 'ARCHIVED' ORDER BY created_at DESC",
  ).map(toProject);
}

/**
 * Reject a project (a pending suggestion or one already accepted). It is archived, never deleted,
 * and the reason feeds the next suggestions so the agent doesn't propose the same kind again.
 */
export function rejectProject(id: string, reason: string | null): Project | null {
  const p = getProject(id);
  if (!p) return null;
  return upsertProject({
    ...p,
    status: 'ARCHIVED',
    rejection: reason?.trim() || 'Sem motivo informado',
    rejectedAt: now(),
  });
}

export function listRejectedProjects(limit = 20): Project[] {
  return all(
    'SELECT * FROM projects WHERE rejected_at IS NOT NULL ORDER BY rejected_at DESC LIMIT :limit',
    { limit },
  ).map(toProject);
}

/** Undo a rejection: back to where it was (suggestion or planned). */
export function restoreProject(id: string): Project | null {
  const p = getProject(id);
  if (!p) return null;
  return upsertProject({
    ...p,
    status: p.aiSuggested ? 'IDEA' : 'PLANNED',
    rejection: null,
    rejectedAt: null,
  });
}

export function getProject(id: string): Project | null {
  const r = one('SELECT * FROM projects WHERE id = :id', { id });
  return r ? toProject(r) : null;
}

export function upsertProject(p: Partial<Project> & { name: string }): Project {
  const prev = p.id ? getProject(p.id) : null;
  const status = p.status ?? prev?.status ?? 'IDEA';
  const next: Project = {
    id: prev?.id ?? p.id ?? randomUUID(),
    name: p.name,
    goal: p.goal ?? prev?.goal ?? null,
    status,
    difficulty: p.difficulty ?? prev?.difficulty ?? null,
    estimatedTime: p.estimatedTime ?? prev?.estimatedTime ?? null,
    technologies: p.technologies ?? prev?.technologies ?? [],
    prerequisites: p.prerequisites ?? prev?.prerequisites ?? [],
    tasks: p.tasks ?? prev?.tasks ?? [],
    aiSuggested: p.aiSuggested ?? prev?.aiSuggested ?? false,
    reason: p.reason ?? prev?.reason ?? null,
    rejection: p.rejection !== undefined ? p.rejection : (prev?.rejection ?? null),
    rejectedAt: p.rejectedAt !== undefined ? p.rejectedAt : (prev?.rejectedAt ?? null),
    sourceContentId: p.sourceContentId ?? prev?.sourceContentId ?? null,
    createdAt: prev?.createdAt ?? now(),
    completedAt: status === 'COMPLETED' ? (prev?.completedAt ?? now()) : null,
  };
  run(
    `INSERT INTO projects (id, name, goal, status, difficulty, estimated_time, technologies, prerequisites, tasks, ai_suggested, reason, rejection, rejected_at, source_content_id, created_at, completed_at)
     VALUES (:id, :name, :goal, :status, :difficulty, :estimatedTime, :technologies, :prerequisites, :tasks, :aiSuggested, :reason, :rejection, :rejectedAt, :sourceContentId, :createdAt, :completedAt)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, goal = excluded.goal, status = excluded.status,
       difficulty = excluded.difficulty, estimated_time = excluded.estimated_time, technologies = excluded.technologies,
       prerequisites = excluded.prerequisites, tasks = excluded.tasks, ai_suggested = excluded.ai_suggested,
       reason = excluded.reason, rejection = excluded.rejection, rejected_at = excluded.rejected_at,
       source_content_id = excluded.source_content_id, completed_at = excluded.completed_at`,
    {
      ...next,
      technologies: json(next.technologies),
      prerequisites: json(next.prerequisites),
      tasks: json(next.tasks),
      aiSuggested: next.aiSuggested ? 1 : 0,
    },
  );
  return next;
}

const NEXT_TASK_STATUS = { TODO: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: 'TODO' } as const;

export function cycleProjectTask(projectId: string, index: number): Project | null {
  const p = getProject(projectId);
  if (!p || !p.tasks[index]) return p;
  const tasks = p.tasks.map((t, i) =>
    i === index ? { ...t, status: NEXT_TASK_STATUS[t.status] } : t,
  );
  const status = p.status === 'IDEA' || p.status === 'PLANNED' ? 'BUILDING' : p.status;
  return upsertProject({
    ...p,
    tasks,
    status: tasks.every((t) => t.status === 'DONE') ? 'COMPLETED' : status,
  });
}

export function acceptSuggestedProject(id: string): Project | null {
  const p = getProject(id);
  return p ? upsertProject({ ...p, aiSuggested: false, status: 'PLANNED' }) : null;
}

// ─── Learning ───────────────────────────────────────────────────────────────

const DEFAULT_STEPS = [
  { name: 'Conceito', minutes: 3 },
  { name: 'Exemplo', minutes: 3 },
  { name: 'Código', minutes: 4 },
  { name: 'Exercício', minutes: 4 },
  { name: 'Verificar entendimento', minutes: 1 },
];

const toLearning = (r: Row): LearningItem => ({
  id: r.id,
  title: r.title,
  track: r.track,
  why: r.why,
  steps: parse(r.steps, []),
  stepsDone: r.steps_done,
  progress: r.progress,
  minutesTotal: r.minutes_total,
  sourceContentId: r.source_content_id,
  sources: parse(r.sources, []),
  writtenAt: r.written_at ?? null,
  updatedAt: r.updated_at,
});

export function listLearning(): LearningItem[] {
  return all('SELECT * FROM learning_items ORDER BY progress >= 100, updated_at DESC').map(
    toLearning,
  );
}

export function getLearning(id: string): LearningItem | null {
  const r = one('SELECT * FROM learning_items WHERE id = :id', { id });
  return r ? toLearning(r) : null;
}

export function upsertLearning(l: Partial<LearningItem> & { title: string }): LearningItem {
  const byTitle = l.id
    ? undefined
    : one('SELECT * FROM learning_items WHERE title = :t', { t: l.title });
  const prev = l.id ? getLearning(l.id) : byTitle ? toLearning(byTitle) : null;
  const steps = l.steps ?? prev?.steps ?? DEFAULT_STEPS;
  const next: LearningItem = {
    id: prev?.id ?? l.id ?? randomUUID(),
    title: l.title,
    track: l.track ?? prev?.track ?? null,
    why: l.why ?? prev?.why ?? null,
    steps,
    stepsDone: clamp(l.stepsDone ?? prev?.stepsDone ?? 0, 0, steps.length),
    progress: clamp(l.progress ?? prev?.progress ?? 0, 0, 100),
    minutesTotal: l.minutesTotal ?? prev?.minutesTotal ?? steps.reduce((a, s) => a + s.minutes, 0),
    sourceContentId: l.sourceContentId ?? prev?.sourceContentId ?? null,
    sources: l.sources ?? prev?.sources ?? [],
    writtenAt: l.writtenAt ?? prev?.writtenAt ?? null,
    updatedAt: now(),
  };
  run(
    `INSERT INTO learning_items (id, title, track, why, steps, steps_done, progress, minutes_total, source_content_id, sources, written_at, updated_at)
     VALUES (:id, :title, :track, :why, :steps, :stepsDone, :progress, :minutesTotal, :sourceContentId, :sources, :writtenAt, :updatedAt)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, track = excluded.track, why = excluded.why, steps = excluded.steps,
       steps_done = excluded.steps_done, progress = excluded.progress, minutes_total = excluded.minutes_total,
       source_content_id = excluded.source_content_id, sources = excluded.sources, written_at = excluded.written_at, updated_at = excluded.updated_at`,
    { ...next, steps: json(next.steps), sources: json(next.sources) },
  );
  return next;
}

/**
 * Lesson reader: mark step `index` done (progress never goes backwards). Finishing the last step
 * records evidence on the matching knowledge node, same as advanceLearning.
 */
export function completeLearningStep(
  id: string,
  index: number,
): { item: LearningItem; finished: boolean } | null {
  const l = getLearning(id);
  if (!l) return null;
  const stepsDone = Math.max(l.stepsDone, Math.min(l.steps.length, index + 1));
  const finished = stepsDone === l.steps.length && l.stepsDone < l.steps.length;
  const item = upsertLearning({
    ...l,
    stepsDone,
    progress: Math.max(l.progress, Math.round((stepsDone / l.steps.length) * 100)),
  });
  if (finished) {
    const k = getKnowledgeByName(l.title);
    upsertKnowledge({
      name: l.title,
      status: k && k.status !== 'DISCOVERED' ? k.status : 'LEARNING',
      confidence: (k?.confidence ?? 0) + 1,
      gapReason: null,
      evidence: [{ kind: 'studied', note: 'Aula concluída', at: now() }],
    });
  }
  return { item, finished };
}

/** Saves the user's answer to a step's exercise (the agent reviews it later). */
export function answerLearningStep(id: string, index: number, answer: string): LearningItem | null {
  const l = getLearning(id);
  if (!l?.steps[index]) return null;
  const steps = l.steps.map((s, i) =>
    i === index
      ? {
          ...s,
          answer: answer.slice(0, 8000),
          answeredAt: now(),
          feedback: s.answer === answer ? s.feedback : undefined,
        }
      : s,
  );
  return upsertLearning({ ...l, steps });
}

/** Lessons that still have only an outline (no written content) — the agent writes these. */
export function listUnwrittenLearning(): LearningItem[] {
  return listLearning().filter((l) => l.progress < 100 && !l.steps.some((s) => s.body));
}

/** Exercise answers waiting for the agent's review. */
export function listPendingReviews() {
  return listLearning().flatMap((l) =>
    l.steps
      .map((s, index) => ({
        learningId: l.id,
        title: l.title,
        index,
        step: s.name,
        exercise: s.exercise ?? null,
        answer: s.answer ?? null,
        feedback: s.feedback ?? null,
      }))
      .filter((x) => x.answer && !x.feedback),
  );
}

/**
 * Advances a learning session one step. Finishing the last step records evidence on the
 * matching knowledge node and raises its confidence (PTR RF-016).
 */
export function advanceLearning(id: string): { item: LearningItem; finished: boolean } | null {
  const l = getLearning(id);
  if (!l) return null;
  const restart = l.stepsDone >= l.steps.length;
  const stepsDone = restart ? 0 : l.stepsDone + 1;
  const finished = stepsDone === l.steps.length;
  const progress = restart
    ? l.progress
    : Math.max(l.progress, Math.round((stepsDone / l.steps.length) * 100));
  const item = upsertLearning({ ...l, stepsDone, progress });
  if (finished) {
    const k = getKnowledgeByName(l.title);
    upsertKnowledge({
      name: l.title,
      status: k && k.status !== 'DISCOVERED' ? k.status : 'LEARNING',
      confidence: (k?.confidence ?? 0) + 1,
      gapReason: null,
      evidence: [{ kind: 'studied', note: 'Sessão de aprendizado concluída', at: now() }],
    });
  }
  return { item, finished };
}

const toPath = (r: Row): LearningPath => ({
  id: r.id,
  goalId: r.goal_id ?? null,
  name: r.name,
  goal: r.goal,
  modules: parse(r.modules, []),
  updatedAt: r.updated_at,
});

export function listLearningPaths(): LearningPath[] {
  return all('SELECT * FROM learning_paths ORDER BY updated_at DESC').map(toPath);
}

export function upsertLearningPath(p: Partial<LearningPath> & { name: string }): LearningPath {
  const existing = one('SELECT * FROM learning_paths WHERE id = :id OR name = :name', {
    id: p.id ?? '',
    name: p.name,
  });
  const prev = existing ? toPath(existing) : null;
  const next: LearningPath = {
    id: prev?.id ?? randomUUID(),
    goalId: p.goalId ?? prev?.goalId ?? null,
    name: p.name,
    goal: p.goal ?? prev?.goal ?? null,
    modules: p.modules ?? prev?.modules ?? [],
    updatedAt: now(),
  };
  run(
    `INSERT INTO learning_paths (id, goal_id, name, goal, modules, updated_at) VALUES (:id, :goalId, :name, :goal, :modules, :updatedAt)
     ON CONFLICT(id) DO UPDATE SET goal_id = excluded.goal_id, name = excluded.name, goal = excluded.goal, modules = excluded.modules, updated_at = excluded.updated_at`,
    { ...next, modules: json(next.modules) },
  );
  return next;
}

// ─── Goals & resources ──────────────────────────────────────────────────────

const toGoal = (r: Row): Goal => ({
  id: r.id,
  text: r.text,
  status: r.status,
  pathId: r.path_id,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createGoal(text: string): Goal {
  const g: Goal = {
    id: randomUUID(),
    text: text.trim(),
    status: 'new',
    pathId: null,
    notes: null,
    createdAt: now(),
    updatedAt: now(),
  };
  run(
    'INSERT INTO goals (id, text, status, path_id, notes, created_at, updated_at) VALUES (:id, :text, :status, :pathId, :notes, :createdAt, :updatedAt)',
    { ...g },
  );
  return g;
}

export function listGoals(opts: { status?: Goal['status'][] } = {}): Goal[] {
  const rows = all(
    `SELECT * FROM goals ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'planning' THEN 1 WHEN 'active' THEN 2 WHEN 'done' THEN 3 ELSE 4 END, created_at DESC`,
  ).map(toGoal);
  return opts.status ? rows.filter((g) => opts.status!.includes(g.status)) : rows;
}

export function getGoal(id: string): Goal | null {
  const r = one('SELECT * FROM goals WHERE id = :id', { id });
  return r ? toGoal(r) : null;
}

export function updateGoal(
  id: string,
  patch: Partial<Pick<Goal, 'text' | 'status' | 'pathId' | 'notes'>>,
): Goal | null {
  const g = getGoal(id);
  if (!g) return null;
  const next = { ...g, ...patch, updatedAt: now() };
  run(
    'UPDATE goals SET text = :text, status = :status, path_id = :pathId, notes = :notes, updated_at = :updatedAt WHERE id = :id',
    {
      id,
      text: next.text,
      status: next.status,
      pathId: next.pathId,
      notes: next.notes,
      updatedAt: next.updatedAt,
    },
  );
  return next;
}

export function archiveGoal(id: string): void {
  run("UPDATE goals SET status = 'archived', updated_at = :at WHERE id = :id", { id, at: now() });
}

const toResource = (r: Row): LearningResource => ({
  id: r.id,
  goalId: r.goal_id,
  pathId: r.path_id,
  module: r.module,
  kind: r.kind,
  title: r.title,
  url: r.url,
  author: r.author,
  minutes: r.minutes,
  level: r.level,
  language: r.language,
  why: r.why,
  done: !!r.done,
  createdAt: r.created_at,
});

export function addResources(items: Omit<LearningResource, 'id' | 'done' | 'createdAt'>[]): {
  added: number;
} {
  let added = 0;
  for (const it of items)
    added += Number(
      run(
        `INSERT OR IGNORE INTO learning_resources (id, goal_id, path_id, module, kind, title, url, author, minutes, level, language, why, created_at)
         VALUES (:id, :goalId, :pathId, :module, :kind, :title, :url, :author, :minutes, :level, :language, :why, :createdAt)`,
        {
          id: randomUUID(),
          goalId: it.goalId ?? null,
          pathId: it.pathId ?? null,
          module: it.module ?? null,
          kind: it.kind,
          title: it.title,
          url: it.url,
          author: it.author ?? null,
          minutes: it.minutes ?? null,
          level: it.level ?? null,
          language: it.language ?? null,
          why: it.why ?? null,
          createdAt: now(),
        },
      ).changes,
    );
  return { added };
}

export function listResources(
  q: { goalId?: string; pathId?: string; limit?: number } = {},
): LearningResource[] {
  const where: string[] = [];
  const p: Params = { limit: q.limit ?? 200 };
  if (q.goalId) (where.push('goal_id = :goalId'), (p.goalId = q.goalId));
  if (q.pathId) (where.push('path_id = :pathId'), (p.pathId = q.pathId));
  return all(
    `SELECT * FROM learning_resources ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY done, created_at LIMIT :limit`,
    p,
  ).map(toResource);
}

/** Marking a resource done records evidence on its module's knowledge node (PTR RF-016). */
export function toggleResourceDone(id: string): boolean {
  const r = one('SELECT * FROM learning_resources WHERE id = :id', { id });
  if (!r) return false;
  const done = !r.done;
  run('UPDATE learning_resources SET done = :d WHERE id = :id', { id, d: done ? 1 : 0 });
  if (done && r.module && getKnowledgeByName(r.module))
    upsertKnowledge({
      name: r.module,
      evidence: [
        {
          kind: r.kind === 'exercise' ? 'exercise' : 'studied',
          note: `Concluiu: ${r.title}`,
          at: now(),
        },
      ],
    });
  return done;
}

// ─── Autonomous discovery ───────────────────────────────────────────────────

/** Pseudo-sources for items that did not come from a feed. Disabled so ingestion skips them. */
export function discoverySource(): Source {
  return upsertSource({
    kind: 'page',
    name: 'Busca autônoma',
    url: 'agent://discovery',
    origin: 'agent',
    enabled: false,
  });
}
export function linksSource(): Source {
  return upsertSource({
    kind: 'page',
    name: 'Links enviados',
    url: 'agent://links',
    origin: 'link',
    enabled: false,
  });
}

export interface DiscoveredItem {
  url: string;
  title: string;
  excerpt?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  creatorId?: string | null;
  backfill?: boolean;
}

/** Adds items found outside feeds (agent web search, links sent by the user). Skips URLs already known. */
export function addDiscoveredContent(items: DiscoveredItem[], via: 'agent' | 'link' = 'agent') {
  const src = via === 'link' ? linksSource() : discoverySource();
  const fresh = items.filter(
    (i) =>
      /^https?:\/\//.test(i.url) &&
      !one('SELECT 1 AS x FROM contents WHERE url = :url', { url: i.url }),
  );
  const r = insertRawContent(fresh.map((i) => ({ ...i, sourceId: src.id, externalId: i.url })));
  return { inserted: r.inserted, skipped: items.length - r.inserted };
}

/** Enabled "page"/"social" sources (no usable feed) that are due for an agent visit or search. */
export function listDuePageSources(): Source[] {
  return listSources({ enabledOnly: true }).filter(
    (s) =>
      (s.kind === 'page' || s.kind === 'social') &&
      (!s.lastFetchedAt ||
        Date.now() - new Date(s.lastFetchedAt).getTime() >= s.everyMinutes * 60_000),
  );
}

// ─── Build Watch ────────────────────────────────────────────────────────────

const toWatch = (r: Row): BuildWatchUpdate => ({
  id: r.id,
  project: r.project,
  author: r.author,
  url: r.url,
  changes: parse(r.changes, []),
  technologies: parse(r.technologies, []),
  why: r.why,
  happenedAt: r.happened_at,
});

export function listBuildWatch(limit = 30): BuildWatchUpdate[] {
  return all('SELECT * FROM build_watch ORDER BY happened_at DESC LIMIT :limit', { limit }).map(
    toWatch,
  );
}

export function addBuildWatch(
  u: Omit<BuildWatchUpdate, 'id' | 'happenedAt'> & { happenedAt?: string },
): BuildWatchUpdate {
  const next: BuildWatchUpdate = { ...u, id: randomUUID(), happenedAt: u.happenedAt ?? now() };
  run(
    `INSERT INTO build_watch (id, project, author, url, changes, technologies, why, happened_at)
     VALUES (:id, :project, :author, :url, :changes, :technologies, :why, :happenedAt)`,
    {
      ...next,
      author: next.author ?? null,
      why: next.why ?? null,
      changes: json(next.changes),
      technologies: json(next.technologies),
    },
  );
  return next;
}

// ─── Briefs ─────────────────────────────────────────────────────────────────

const toBrief = (r: Row): Brief => ({
  date: r.date,
  type: r.type,
  headline: r.headline,
  intro: r.intro,
  itemIds: parse(r.item_ids, []),
  blocks: parse(r.blocks, []),
  nextMove: parse(r.next_move, null),
  stats: parse(r.stats, {}),
  createdAt: r.created_at,
});

export function getBrief(type: Brief['type'] = 'daily', date?: string): Brief | null {
  const r = date
    ? one('SELECT * FROM briefs WHERE type = :type AND date = :date', { type, date })
    : one('SELECT * FROM briefs WHERE type = :type ORDER BY date DESC LIMIT 1', { type });
  return r ? toBrief(r) : null;
}

export function saveBrief(b: Omit<Brief, 'createdAt'>): Brief {
  const next: Brief = { ...b, createdAt: now() };
  run(
    `INSERT INTO briefs (date, type, headline, intro, item_ids, blocks, next_move, stats, created_at)
     VALUES (:date, :type, :headline, :intro, :itemIds, :blocks, :nextMove, :stats, :createdAt)
     ON CONFLICT(date, type) DO UPDATE SET headline = excluded.headline, intro = excluded.intro, item_ids = excluded.item_ids,
       blocks = excluded.blocks, next_move = excluded.next_move, stats = excluded.stats, created_at = excluded.created_at`,
    {
      ...next,
      intro: next.intro ?? null,
      itemIds: json(next.itemIds),
      blocks: json(next.blocks),
      nextMove: next.nextMove ? json(next.nextMove) : null,
      stats: json(next.stats),
    },
  );
  return next;
}

// ─── Agent runs (observability, PTR §63) ────────────────────────────────────

const toRun = (r: Row): AgentRun => ({
  id: r.id,
  task: r.task,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  summary: r.summary,
  stats: parse(r.stats, {}),
});

export function startAgentRun(task: string): AgentRun {
  const r: AgentRun = {
    id: randomUUID(),
    task,
    startedAt: now(),
    finishedAt: null,
    summary: null,
    stats: {},
  };
  run('INSERT INTO agent_runs (id, task, started_at) VALUES (:id, :task, :startedAt)', {
    id: r.id,
    task,
    startedAt: r.startedAt,
  });
  return r;
}

export function finishAgentRun(
  id: string,
  summary: string,
  stats: Record<string, number> = {},
): void {
  run(
    'UPDATE agent_runs SET finished_at = :at, summary = :summary, stats = :stats WHERE id = :id',
    { id, at: now(), summary, stats: json(stats) },
  );
}

export function listAgentRuns(limit = 10): AgentRun[] {
  return all('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT :limit', { limit }).map(
    toRun,
  );
}

/** Latest moment the brain changed: an agent run finished or a source was fetched. */
export function lastUpdatedAt(): string | null {
  const r = one(
    `SELECT MAX(t) AS t FROM (SELECT MAX(finished_at) AS t FROM agent_runs UNION ALL SELECT MAX(last_fetched_at) FROM sources UNION ALL SELECT MAX(analyzed_at) FROM contents)`,
  );
  return r?.t ?? null;
}

// ─── Dashboard, evolution, search ───────────────────────────────────────────

const count = (sql: string, p: Params = {}) => Number(one(sql, p)?.n ?? 0);

export function getPulse() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const limits = getProfile().limits;
  const area = (a: Area) =>
    count(
      `SELECT COUNT(*) AS n FROM contents WHERE status = 'analyzed' AND backfill = 0 AND user_state != 'IGNORED' AND area = :a AND analyzed_at >= :since`,
      { a, since },
    );
  const now_ = Math.min(area('now'), limits.now);
  const learn = Math.min(
    area('learn') + count('SELECT COUNT(*) AS n FROM learning_items WHERE progress < 100'),
    limits.learn,
  );
  const build = Math.min(area('build') + (getSuggestedProject() ? 1 : 0), limits.build);
  const frontier = Math.min(area('frontier'), limits.frontier);
  const collected = count(
    'SELECT COUNT(*) AS n FROM contents WHERE backfill = 0 AND retrieved_at >= :since',
    { since },
  );
  const minutes = count(
    `SELECT COALESCE(SUM(read_minutes), 0) AS n FROM (SELECT read_minutes FROM contents WHERE status = 'analyzed' AND backfill = 0 AND area = 'now' AND analyzed_at >= :since ORDER BY priority LIMIT :l)`,
    { since, l: limits.now },
  );
  const pending = count("SELECT COUNT(*) AS n FROM contents WHERE status = 'pending'");
  return {
    now: now_,
    learn,
    build,
    frontier,
    total: now_ + learn + build + frontier,
    collected,
    minutes,
    pending,
  };
}

export function getEvolution() {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const knowledge = listKnowledge();
  const newConcepts = knowledge.filter((k) => k.createdAt >= weekAgo);
  const projects = listProjects();
  const evidenceSince = (since: string, kinds?: string[]) =>
    knowledge.reduce(
      (a, k) =>
        a + k.evidence.filter((e) => e.at >= since && (!kinds || kinds.includes(e.kind))).length,
      0,
    );

  const byDomain = new Map<string, { sum: number; n: number; recent: number }>();
  for (const k of knowledge) {
    const d = byDomain.get(k.domain) ?? { sum: 0, n: 0, recent: 0 };
    d.sum += k.confidence;
    d.n += 1;
    d.recent += k.evidence.filter((e) => e.at >= monthAgo).length;
    byDomain.set(k.domain, d);
  }
  const areas = [...byDomain.entries()]
    .map(([name, d]) => ({ name, level: Math.round((d.sum / d.n) * 10), delta: d.recent }))
    .sort((a, b) => b.level - a.level)
    .slice(0, 6);

  const analyzed = count('SELECT COUNT(*) AS n FROM contents WHERE analyzed_at >= :w', {
    w: weekAgo,
  });
  const relevant = count(
    "SELECT COUNT(*) AS n FROM contents WHERE status = 'analyzed' AND analyzed_at >= :w",
    { w: weekAgo },
  );
  const studied =
    count(
      "SELECT COUNT(*) AS n FROM contents WHERE user_state IN ('LEARNING','COMPLETED','READ','SAVED') AND analyzed_at >= :w",
      { w: weekAgo },
    ) + evidenceSince(weekAgo, ['studied', 'exercise', 'tutorial']);
  const applied = evidenceSince(weekAgo, ['applied', 'used', 'project']);
  const started = projects.filter((p) => p.createdAt >= weekAgo).length;
  const completed = projects.filter((p) => p.completedAt && p.completedAt >= weekAgo).length;
  const sessions = evidenceSince(weekAgo, ['studied']);
  return {
    trends: {
      knowledge: newConcepts.length,
      projectsStarted: started,
      projectsCompleted: completed,
      sessions,
    },
    areas,
    funnel: {
      relevant,
      studied,
      applied,
      built: completed + projects.filter((p) => p.status === 'BUILDING').length,
    },
    k2a: relevant ? Math.round((applied / relevant) * 100) : 0,
    weekly: { analyzed, relevant, sessions, started, completed },
    newConcepts: newConcepts.slice(0, 8),
  };
}

export type SearchHit = {
  kind: 'content' | 'knowledge' | 'project' | 'learning';
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
};

export function search(q: string, limit = 20): SearchHit[] {
  if (!q.trim()) return [];
  const like = `%${q.trim()}%`;
  const hits: SearchHit[] = [];
  for (const r of all(
    'SELECT id, name, status FROM knowledge WHERE name LIKE :like OR full_name LIKE :like OR description LIKE :like LIMIT 8',
    { like },
  ))
    hits.push({
      kind: 'knowledge',
      id: r.id,
      title: r.name,
      subtitle: r.status,
      href: `/knowledge?k=${encodeURIComponent(r.name)}`,
    });
  for (const r of all(
    'SELECT id, name, status FROM projects WHERE name LIKE :like OR goal LIKE :like LIMIT 5',
    { like },
  ))
    hits.push({
      kind: 'project',
      id: r.id,
      title: r.name,
      subtitle: r.status,
      href: `/build?p=${r.id}`,
    });
  for (const r of all(
    'SELECT id, title, progress FROM learning_items WHERE title LIKE :like LIMIT 5',
    { like },
  ))
    hits.push({
      kind: 'learning',
      id: r.id,
      title: r.title,
      subtitle: `${r.progress}%`,
      href: `/learn/${r.id}`,
    });
  for (const r of all(
    "SELECT id, title, category FROM contents WHERE status = 'analyzed' AND (title LIKE :like OR summary LIKE :like OR tags LIKE :like) ORDER BY analyzed_at DESC LIMIT 10",
    { like },
  ))
    hits.push({
      kind: 'content',
      id: r.id,
      title: r.title,
      subtitle: r.category,
      href: `/content/${r.id}`,
    });
  return hits.slice(0, limit);
}

// ─── Catch-up milestones ────────────────────────────────────────────────────

const toMilestone = (r: Row): Milestone => ({
  id: r.id,
  topic: r.topic,
  happenedAt: r.happened_at,
  title: r.title,
  summary: r.summary,
  why: r.why,
  importance: r.importance,
  links: parse(r.links, []),
  contentId: r.content_id,
  state: r.state,
  createdAt: r.created_at,
});

/** Upsert by (topic, title) so re-running catch-up refines instead of duplicating. User state is kept. */
export function addMilestones(items: Omit<Milestone, 'id' | 'state' | 'createdAt'>[]): {
  saved: number;
} {
  for (const m of items)
    run(
      `INSERT INTO milestones (id, topic, happened_at, title, summary, why, importance, links, content_id, created_at)
       VALUES (:id, :topic, :happenedAt, :title, :summary, :why, :importance, :links, :contentId, :createdAt)
       ON CONFLICT(topic, title) DO UPDATE SET happened_at = excluded.happened_at, summary = excluded.summary, why = excluded.why,
         importance = excluded.importance, links = excluded.links, content_id = COALESCE(excluded.content_id, milestones.content_id)`,
      {
        id: randomUUID(),
        topic: m.topic,
        happenedAt: m.happenedAt,
        title: m.title,
        summary: m.summary,
        why: m.why ?? null,
        importance: m.importance,
        links: json(m.links ?? []),
        contentId: m.contentId ?? null,
        createdAt: now(),
      },
    );
  return { saved: items.length };
}

export function listMilestones(q: { months?: number; topic?: string } = {}): Milestone[] {
  const since = new Date(Date.now() - (q.months ?? 24) * 30.44 * 86400_000)
    .toISOString()
    .slice(0, 10);
  return all(
    `SELECT * FROM milestones WHERE happened_at >= :since ${q.topic ? 'AND lower(topic) = lower(:topic)' : ''}
     ORDER BY happened_at DESC`,
    q.topic ? { since, topic: q.topic } : { since },
  ).map(toMilestone);
}

export function setMilestoneState(id: string, state: MilestoneState): Milestone | null {
  run('UPDATE milestones SET state = :state WHERE id = :id', { id, state });
  const r = one('SELECT * FROM milestones WHERE id = :id', { id });
  if (!r) return null;
  const m = toMilestone(r);
  // "Já sei" is evidence on the topic; "Estudar" queues a session.
  if (state === 'known' && getKnowledgeByName(m.topic))
    upsertKnowledge({
      name: m.topic,
      evidence: [{ kind: 'studied', note: `Em dia: ${m.title}`, at: now() }],
    });
  if (state === 'studying')
    upsertLearning({
      title: m.title,
      track: m.topic.toUpperCase(),
      why: m.why ?? m.summary,
      sourceContentId: m.contentId,
    });
  return m;
}

/** How caught-up the user is per topic: resolved essentials+important over total. */
export function catchupProgress(months = 24) {
  const by = new Map<
    string,
    { total: number; done: number; essential: number; essentialDone: number }
  >();
  for (const m of listMilestones({ months })) {
    if (m.importance === 'nice') continue;
    const t = by.get(m.topic) ?? { total: 0, done: 0, essential: 0, essentialDone: 0 };
    const resolved = m.state === 'known' || m.state === 'skipped';
    t.total++;
    if (resolved) t.done++;
    if (m.importance === 'essential') (t.essential++, resolved && t.essentialDone++);
    by.set(m.topic, t);
  }
  return [...by.entries()]
    .map(([topic, v]) => ({
      topic,
      ...v,
      pct: v.total ? Math.round((v.done / v.total) * 100) : 100,
    }))
    .sort((a, b) => a.pct - b.pct);
}

// ─── Lesson readings ────────────────────────────────────────────────────────

/** Analyzed content and study resources related to a lesson — something to read even before it is written. */
export function learningReadings(l: Pick<LearningItem, 'title' | 'sourceContentId'>) {
  const t = l.title.toLowerCase();
  // Key terms of the title ("Governança de tools em agentes LLM (MCP)" → tools, agentes, llm, mcp)
  const terms = [
    ...new Set(
      t
        .split(/[^\p{L}\p{N}.+#-]+/u)
        .filter(
          (w) =>
            w.length >= 3 &&
            !['para', 'com', 'sem', 'dos', 'das', 'que', 'por', 'uma', 'entre'].includes(w),
        ),
    ),
  ].slice(0, 5);
  const p: Params = { src: l.sourceContentId ?? '', t };
  terms.forEach((w, i) => (p[`w${i}`] = `%${w}%`));
  const termSql = terms
    .map((_, i) => `lower(c.title) LIKE :w${i} OR lower(COALESCE(c.learn_topic, '')) LIKE :w${i}`)
    .join(' OR ');
  const contents = all(
    `SELECT c.id, c.title, c.summary, c.url, c.area, c.read_minutes,
       (c.id = :src) * 10 + (lower(COALESCE(c.learn_topic, '')) = :t) * 5 ${terms.map((_, i) => `+ (lower(c.title) LIKE :w${i})`).join(' ')} AS score
     FROM contents c WHERE c.status = 'analyzed' AND (c.id = :src OR lower(COALESCE(c.learn_topic, '')) = :t ${termSql ? `OR ${termSql}` : ''})
     ORDER BY score DESC, c.analyzed_at DESC LIMIT 8`,
    p,
  ).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    summary: r.summary as string | null,
    url: r.url as string,
    minutes: r.read_minutes as number | null,
  }));
  const resources = all(
    `SELECT * FROM learning_resources WHERE lower(COALESCE(module, '')) = :t ${terms.map((_, i) => `OR lower(title) LIKE :w${i}`).join(' ')} ORDER BY done, created_at LIMIT 8`,
    Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')),
  ).map(toResource);
  return { contents, resources };
}

// ─── Low relevance / archive ────────────────────────────────────────────────

export type ArchiveKind = 'low' | 'discarded' | 'duplicate' | 'pending';

export interface ArchiveQuery {
  kind: ArchiveKind;
  q?: string;
  sourceId?: string;
  sinceDays?: number;
  limit?: number;
  offset?: number;
}

/**
 * Everything that did not make the daily cut, so the user can audit the curation:
 *   low       analyzed but P3 (interesting, no urgency)
 *   discarded ignored by the agent (with its reason) or by the user ("não é para mim")
 *   duplicate grouped under another item
 *   pending   collected, not triaged yet
 */
export function listArchive(q: ArchiveQuery): { items: Content[]; total: number } {
  const where = ['c.backfill = 0'];
  const p: Params = {};
  if (q.kind === 'low')
    where.push("c.status = 'analyzed' AND c.priority IN ('P3','P4') AND c.user_state != 'IGNORED'");
  if (q.kind === 'discarded')
    where.push("(c.status = 'ignored' OR (c.status = 'analyzed' AND c.user_state = 'IGNORED'))");
  if (q.kind === 'duplicate') where.push("c.status = 'duplicate'");
  if (q.kind === 'pending') where.push("c.status = 'pending'");
  if (q.q?.trim())
    (where.push('(c.title LIKE :q OR c.excerpt LIKE :q OR c.summary LIKE :q)'),
      (p.q = `%${q.q.trim()}%`));
  if (q.sourceId) (where.push('c.source_id = :sid'), (p.sid = q.sourceId));
  if (q.sinceDays)
    (where.push('COALESCE(c.published_at, c.retrieved_at) >= :since'),
      (p.since = new Date(Date.now() - q.sinceDays * 86400_000).toISOString()));
  const w = where.join(' AND ');
  const total = Number(one(`SELECT COUNT(*) AS n FROM contents c WHERE ${w}`, p)?.n ?? 0);
  const items = all(
    `${CONTENT_SELECT} WHERE ${w} ORDER BY COALESCE(c.published_at, c.retrieved_at) DESC LIMIT :limit OFFSET :offset`,
    {
      ...p,
      limit: q.limit ?? 40,
      offset: q.offset ?? 0,
    },
  ).map(toContent);
  return { items, total };
}

export function archiveCounts(): Record<ArchiveKind, number> {
  const n = (w: string) =>
    count(`SELECT COUNT(*) AS n FROM contents c WHERE c.backfill = 0 AND ${w}`);
  return {
    low: n("c.status = 'analyzed' AND c.priority IN ('P3','P4') AND c.user_state != 'IGNORED'"),
    discarded: n("(c.status = 'ignored' OR (c.status = 'analyzed' AND c.user_state = 'IGNORED'))"),
    duplicate: n("c.status = 'duplicate'"),
    pending: n("c.status = 'pending'"),
  };
}

/**
 * "Isso é relevante": the user overrides the curation. Discarded/duplicate items go back to
 * triage flagged very_relevant (the agent must analyze them); low-priority ones are saved.
 * Either way it becomes a calibration signal (get_feedback).
 */
export function rescueContent(id: string): Content | null {
  const c = getContent(id);
  if (!c) return null;
  addFeedback(id, 'very_relevant');
  if (c.status === 'ignored' || c.status === 'duplicate')
    run(
      "UPDATE contents SET status = 'pending', duplicate_of = NULL, user_state = 'SAVED' WHERE id = :id",
      { id },
    );
  else setUserState(id, 'SAVED');
  return getContent(id);
}

// ─── Agent telemetry (PTR §63): sessions, tool calls, per-run metrics ───────

export function startMcpSession(s: {
  id: string;
  agent: string | null;
  roles: string[];
  toolsExposed: number;
  schemaBytes: number;
}) {
  run(
    'INSERT INTO mcp_sessions (id, started_at, agent, roles, tools_exposed, schema_bytes) VALUES (:id, :at, :agent, :roles, :n, :bytes)',
    {
      id: s.id,
      at: now(),
      agent: s.agent,
      roles: s.roles.join(','),
      n: s.toolsExposed,
      bytes: s.schemaBytes,
    },
  );
}

export function updateMcpSessionTools(
  id: string,
  roles: string[],
  toolsExposed: number,
  schemaBytes: number,
) {
  run(
    'UPDATE mcp_sessions SET roles = :roles, tools_exposed = :n, schema_bytes = :b WHERE id = :id',
    { id, roles: roles.join(','), n: toolsExposed, b: schemaBytes },
  );
}

/** The agent run a tool call belongs to: the most recent unfinished run started in the last 3 hours. */
function currentRunId(): string | null {
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  return (
    (one(
      'SELECT id FROM agent_runs WHERE finished_at IS NULL AND started_at >= :since ORDER BY started_at DESC LIMIT 1',
      { since },
    )?.id as string) ?? null
  );
}

export function logToolCall(c: {
  sessionId: string;
  tool: string;
  startedAt: string;
  ms: number;
  ok: boolean;
  error?: string | null;
}) {
  try {
    run(
      'INSERT INTO tool_calls (session_id, run_id, tool, started_at, ms, ok, error) VALUES (:s, :r, :t, :at, :ms, :ok, :e)',
      {
        s: c.sessionId,
        r: currentRunId(),
        t: c.tool,
        at: c.startedAt,
        ms: Math.round(c.ms),
        ok: c.ok ? 1 : 0,
        e: c.error?.slice(0, 500) ?? null,
      },
    );
  } catch {
    // Telemetry must never break a tool call.
  }
}

export interface RunMetrics {
  id: string;
  task: string;
  startedAt: string;
  finishedAt: string | null;
  seconds: number | null;
  calls: number;
  errors: number;
  errorRate: number;
  distinctTools: number;
  toolsExposed: number | null;
  schemaBytes: number | null;
  roles: string | null;
  summary: string | null;
}

export function listRunMetrics(limit = 30): RunMetrics[] {
  return all(
    `SELECT r.id, r.task, r.started_at, r.finished_at, r.summary,
       COUNT(t.id) AS calls, COALESCE(SUM(1 - t.ok), 0) AS errors, COUNT(DISTINCT t.tool) AS distinct_tools,
       MAX(s.tools_exposed) AS tools_exposed, MAX(s.schema_bytes) AS schema_bytes, MAX(s.roles) AS roles
     FROM agent_runs r
     LEFT JOIN tool_calls t ON t.run_id = r.id
     LEFT JOIN mcp_sessions s ON s.id = t.session_id
     GROUP BY r.id ORDER BY r.started_at DESC LIMIT :limit`,
    { limit },
  ).map((r) => ({
    id: r.id,
    task: r.task,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    seconds: r.finished_at
      ? Math.round((Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000)
      : null,
    calls: Number(r.calls),
    errors: Number(r.errors),
    errorRate: Number(r.calls) ? Math.round((Number(r.errors) / Number(r.calls)) * 1000) / 10 : 0,
    distinctTools: Number(r.distinct_tools),
    toolsExposed: r.tools_exposed ?? null,
    schemaBytes: r.schema_bytes ?? null,
    roles: r.roles ?? null,
    summary: r.summary,
  }));
}

export function listToolStats(sinceDays = 14) {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  return all(
    `SELECT tool, COUNT(*) AS calls, SUM(1 - ok) AS errors, ROUND(AVG(ms)) AS avg_ms, MAX(ms) AS max_ms,
       (SELECT error FROM tool_calls e WHERE e.tool = t.tool AND e.ok = 0 ORDER BY e.id DESC LIMIT 1) AS last_error
     FROM tool_calls t WHERE started_at >= :since GROUP BY tool ORDER BY calls DESC`,
    { since },
  ).map((r) => ({
    tool: r.tool as string,
    calls: Number(r.calls),
    errors: Number(r.errors),
    avgMs: Number(r.avg_ms),
    maxMs: Number(r.max_ms),
    lastError: r.last_error as string | null,
  }));
}

export function listMcpSessions(limit = 20) {
  return all('SELECT * FROM mcp_sessions ORDER BY started_at DESC LIMIT :limit', { limit }).map(
    (r) => ({
      id: r.id as string,
      startedAt: r.started_at as string,
      agent: r.agent as string | null,
      roles: r.roles as string,
      toolsExposed: Number(r.tools_exposed),
      schemaBytes: Number(r.schema_bytes),
    }),
  );
}
