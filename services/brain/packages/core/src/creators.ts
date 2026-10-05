// Pessoas: tech news presenters and builders, followed across every platform they post on.
import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { addLink, type AddLinkResult } from './links';
import { listSources, setSourceEnabled } from './repo';
import type { Content, Creator, CreatorChannel } from './types';

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const parse = <T>(v: unknown, f: T): T => {
  try {
    return typeof v === 'string' ? ((JSON.parse(v) as T) ?? f) : f;
  } catch {
    return f;
  }
};

const toCreator = (r: Row): Creator => ({
  id: r.id,
  name: r.name,
  bio: r.bio,
  topics: parse(r.topics, []),
  status: r.status,
  reason: r.reason,
  createdAt: r.created_at,
});

export interface CreatorView extends Creator {
  channels: CreatorChannel[];
  lastPostAt: string | null;
  posts7d: number;
}

export function getCreator(id: string): Creator | null {
  const r = getDb().prepare('SELECT * FROM creators WHERE id = :id').get({ id }) as Row | undefined;
  return r ? toCreator(r) : null;
}

export function listCreators(opts: { status?: Creator['status'][] } = {}): CreatorView[] {
  const rows = (
    getDb().prepare('SELECT * FROM creators ORDER BY name COLLATE NOCASE').all() as Row[]
  ).map(toCreator);
  const sources = listSources();
  const stats = new Map(
    (
      getDb()
        .prepare(
          `SELECT creator_id, MAX(COALESCE(published_at, retrieved_at)) AS last, SUM(CASE WHEN COALESCE(published_at, retrieved_at) >= :week THEN 1 ELSE 0 END) AS n7
           FROM contents WHERE creator_id IS NOT NULL GROUP BY creator_id`,
        )
        .all({ week: new Date(Date.now() - 7 * 86400_000).toISOString() }) as Row[]
    ).map((r) => [r.creator_id, r]),
  );
  return rows
    .filter((c) => !opts.status || opts.status.includes(c.status))
    .map((c) => ({
      ...c,
      channels: sources
        .filter((s) => s.creatorId === c.id)
        .map((s) => ({
          sourceId: s.id,
          platform: s.platform,
          kind: s.kind,
          url: s.url,
          name: s.name,
          enabled: s.enabled,
          lastFetchedAt: s.lastFetchedAt,
          lastError: s.lastError,
        })),
      lastPostAt: stats.get(c.id)?.last ?? null,
      posts7d: Number(stats.get(c.id)?.n7 ?? 0),
    }))
    .sort((a, b) => (b.lastPostAt ?? '').localeCompare(a.lastPostAt ?? ''));
}

function insertCreator(c: Omit<Creator, 'id' | 'createdAt'>): Creator {
  const existing = getDb()
    .prepare('SELECT * FROM creators WHERE lower(name) = lower(:name)')
    .get({ name: c.name }) as Row | undefined;
  if (existing) {
    if (existing.status === 'suggested' && c.status === 'following')
      getDb()
        .prepare("UPDATE creators SET status = 'following' WHERE id = :id")
        .run({ id: existing.id });
    return toCreator({
      ...existing,
      status: c.status === 'following' ? 'following' : existing.status,
    });
  }
  const next: Creator = { ...c, id: randomUUID(), createdAt: now() };
  getDb()
    .prepare(
      'INSERT INTO creators (id, name, bio, topics, status, reason, created_at) VALUES (:id, :name, :bio, :topics, :status, :reason, :createdAt)',
    )
    .run({
      id: next.id,
      name: next.name,
      bio: next.bio ?? null,
      topics: JSON.stringify(next.topics),
      status: next.status,
      reason: next.reason ?? null,
      createdAt: next.createdAt,
    });
  return next;
}

/**
 * Follow a person: every link (YouTube, Instagram, TikTok, X, Bluesky, blog…) becomes a channel.
 * Channels without a public feed are checked by the agent on the daily run.
 */
export async function addCreator(input: {
  name: string;
  links: string[];
  bio?: string | null;
  topics?: string[];
  status?: Creator['status'];
  reason?: string | null;
}) {
  const creator = insertCreator({
    name: input.name.trim(),
    bio: input.bio ?? null,
    topics: input.topics ?? [],
    status: input.status ?? 'following',
    reason: input.reason ?? null,
  });
  const channels: (AddLinkResult | { error: string; url: string })[] = [];
  for (const url of input.links.map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l))) {
    try {
      const r = await addLink(url, { creatorId: creator.id });
      getDb()
        .prepare('UPDATE contents SET creator_id = :c WHERE source_id = :s AND creator_id IS NULL')
        .run({ c: creator.id, s: r.source.id });
      // Suggested people don't consume collection until the user follows them.
      if (creator.status !== 'following') setSourceEnabled(r.source.id, false);
      channels.push(r);
    } catch (e) {
      channels.push({ url, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { creator, channels };
}

export function setCreatorStatus(id: string, status: Creator['status']): void {
  getDb().prepare('UPDATE creators SET status = :status WHERE id = :id').run({ id, status });
  for (const s of listSources())
    if (s.creatorId === id) setSourceEnabled(s.id, status === 'following');
}

/** Latest items from people you follow (analyzed or still pending). */
export function listCreatorPosts(
  opts: { creatorId?: string; days?: number; limit?: number } = {},
): (Pick<
  Content,
  | 'id'
  | 'title'
  | 'url'
  | 'publishedAt'
  | 'retrievedAt'
  | 'status'
  | 'summary'
  | 'whyItMatters'
  | 'creatorId'
> & { creatorName: string; platform: string | null })[] {
  const since = new Date(Date.now() - (opts.days ?? 14) * 86400_000).toISOString();
  return (
    getDb()
      .prepare(
        `SELECT c.id, c.title, c.url, c.published_at, c.retrieved_at, c.status, c.summary, c.why_it_matters, c.creator_id, cr.name AS creator_name, s.platform
         FROM contents c JOIN creators cr ON cr.id = c.creator_id LEFT JOIN sources s ON s.id = c.source_id
         WHERE cr.status = 'following' AND c.status NOT IN ('ignored','duplicate') AND COALESCE(c.published_at, c.retrieved_at) >= :since
         ${opts.creatorId ? 'AND c.creator_id = :cid' : ''}
         ORDER BY COALESCE(c.published_at, c.retrieved_at) DESC LIMIT :limit`,
      )
      .all(
        opts.creatorId
          ? { since, cid: opts.creatorId, limit: opts.limit ?? 60 }
          : { since, limit: opts.limit ?? 60 },
      ) as Row[]
  ).map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    retrievedAt: r.retrieved_at,
    status: r.status,
    summary: r.summary,
    whyItMatters: r.why_it_matters,
    creatorId: r.creator_id,
    creatorName: r.creator_name,
    platform: r.platform,
  }));
}
