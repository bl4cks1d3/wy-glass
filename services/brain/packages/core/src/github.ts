// GitHub em alta: which projects are gaining stars — globally, in the user's stack, and
// among the ones posted by people they follow. Star history is snapshotted daily so growth
// (+stars in 7 days) is measured, not guessed.
import { getDb } from './db';
import { topicQuery } from './discover';
import { getProfile } from './repo';
import type { Repo } from './types';

type Row = Record<string, any>;
const UA = 'MyCurrentBrain/0.1 (+personal technical intelligence)';
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const parse = <T>(v: unknown, f: T): T => {
  try {
    return typeof v === 'string' ? ((JSON.parse(v) as T) ?? f) : f;
  } catch {
    return f;
  }
};

const ghHeaders = (): Record<string, string> => ({
  'user-agent': UA,
  accept: 'application/vnd.github+json',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});

async function gh(path: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 403 || res.status === 429)
    throw new Error('limite da API do GitHub (defina GITHUB_TOKEN para 5000 req/h)');
  if (!res.ok) throw new Error(`GitHub ${res.status} ${path.split('?')[0]}`);
  return res.json();
}

// ─── Store ──────────────────────────────────────────────────────────────────

const toRepo = (r: Row): Repo => ({
  fullName: r.full_name,
  url: r.url,
  description: r.description,
  language: r.language,
  topics: parse(r.topics, []),
  stars: r.stars,
  forks: r.forks,
  createdAt: r.created_at,
  pushedAt: r.pushed_at,
  firstSeen: r.first_seen,
  refreshedAt: r.refreshed_at,
  whyItMatters: r.why_it_matters,
  via: r.via,
});

interface RepoInput {
  fullName: string;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  stars?: number;
  forks?: number;
  createdAt?: string | null;
  pushedAt?: string | null;
  via?: string;
  trendingGain?: number;
  trendingPeriod?: 'daily' | 'weekly';
}

function upsertRepo(r: RepoInput) {
  const db = getDb();
  db.prepare(
    `INSERT INTO repos (full_name, url, description, language, topics, stars, forks, created_at, pushed_at, first_seen, refreshed_at, via)
     VALUES (:fullName, :url, :description, :language, :topics, :stars, :forks, :createdAt, :pushedAt, :at, :refreshed, :via)
     ON CONFLICT(full_name) DO UPDATE SET
       description = COALESCE(excluded.description, repos.description), language = COALESCE(excluded.language, repos.language),
       topics = CASE WHEN excluded.topics != '[]' THEN excluded.topics ELSE repos.topics END,
       stars = CASE WHEN excluded.stars > 0 THEN excluded.stars ELSE repos.stars END,
       forks = CASE WHEN excluded.forks > 0 THEN excluded.forks ELSE repos.forks END,
       created_at = COALESCE(excluded.created_at, repos.created_at), pushed_at = COALESCE(excluded.pushed_at, repos.pushed_at),
       refreshed_at = COALESCE(excluded.refreshed_at, repos.refreshed_at), via = COALESCE(repos.via, excluded.via)`,
  ).run({
    fullName: r.fullName,
    url: `https://github.com/${r.fullName}`,
    description: r.description ?? null,
    language: r.language ?? null,
    topics: JSON.stringify(r.topics ?? []),
    stars: r.stars ?? 0,
    forks: r.forks ?? 0,
    createdAt: r.createdAt ?? null,
    pushedAt: r.pushedAt ?? null,
    at: now(),
    refreshed: r.stars ? now() : null,
    via: r.via ?? null,
  });
  if (r.trendingGain)
    db.prepare(
      'UPDATE repos SET trending_gain = :g, trending_period = :p, trending_at = :at WHERE full_name = :n',
    ).run({ g: r.trendingGain, p: r.trendingPeriod ?? 'daily', at: now(), n: r.fullName });
  if (r.stars)
    db.prepare(
      'INSERT OR REPLACE INTO repo_snapshots (full_name, day, stars) VALUES (:n, :d, :s)',
    ).run({ n: r.fullName, d: today(), s: r.stars });
}

// ─── Mentions: repos linked from any content (creator posts, HN, blogs…) ────

const REPO_RE = /github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})/g;
const NOT_OWNERS = new Set([
  'orgs',
  'topics',
  'features',
  'sponsors',
  'marketplace',
  'settings',
  'login',
  'about',
  'pricing',
  'collections',
  'trending',
  'apps',
  'enterprise',
  'security',
  'site',
  'readme',
]);

export function extractRepos(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REPO_RE)) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, '').replace(/[.,)]+$/, '');
    if (!NOT_OWNERS.has(owner.toLowerCase()) && repo && !repo.startsWith('.'))
      out.add(`${owner}/${repo}`);
  }
  return [...out];
}

/** Scans items collected since the last pass for GitHub links and tracks those repos. */
export function scanMentions(sinceIso?: string): number {
  const db = getDb();
  const since = sinceIso ?? new Date(Date.now() - 3 * 86400_000).toISOString();
  const rows = db
    .prepare(
      'SELECT id, url, title, excerpt, creator_id, retrieved_at FROM contents WHERE retrieved_at >= :since',
    )
    .all({ since }) as Row[];
  let found = 0;
  for (const r of rows) {
    for (const fullName of extractRepos(`${r.url} ${r.title} ${r.excerpt ?? ''}`)) {
      upsertRepo({ fullName, via: r.creator_id ? 'post' : 'mention' });
      found += Number(
        db
          .prepare(
            'INSERT OR IGNORE INTO repo_mentions (full_name, content_id, creator_id, at) VALUES (:n, :c, :cr, :at)',
          )
          .run({ n: fullName, c: r.id, cr: r.creator_id ?? null, at: r.retrieved_at }).changes,
      );
    }
  }
  return found;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

const num = (s: string | undefined) => Number((s ?? '0').replace(/[^\d]/g, '')) || 0;

/** github.com/trending has no API; the page is public and stable. */
export async function fetchTrending(opts: { since?: 'daily' | 'weekly'; language?: string } = {}) {
  const lang = opts.language
    ? `/${encodeURIComponent(opts.language.toLowerCase().replace(/\s+/g, '-').replace('#', '%23'))}`
    : '';
  const res = await fetch(`https://github.com/trending${lang}?since=${opts.since ?? 'daily'}`, {
    headers: { 'user-agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`trending ${res.status}`);
  const html = await res.text();
  const repos: (RepoInput & { gained: number })[] = [];
  for (const block of html.split('<article class="Box-row"').slice(1)) {
    const name = block.match(/<h2[^>]*>[\s\S]*?href="\/([^"/]+\/[^"/]+)"/)?.[1];
    if (!name) continue;
    const desc = block
      .match(/<p class="col-9[^"]*">([\s\S]*?)<\/p>/)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    repos.push({
      fullName: name,
      description: desc
        ? desc
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
        : null,
      language: block.match(/itemprop="programmingLanguage">([^<]+)</)?.[1] ?? null,
      stars: num(block.match(/\/stargazers"[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, '')),
      forks: num(block.match(/\/forks"[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]+>/g, '')),
      gained: num(block.match(/([\d,]+)\s+stars?\s+(today|this week)/)?.[1]),
      trendingGain: num(block.match(/([\d,]+)\s+stars?\s+(today|this week)/)?.[1]),
      trendingPeriod: opts.since ?? 'daily',
      via: `trending-${opts.since ?? 'daily'}`,
    });
  }
  for (const r of repos) upsertRepo(r);
  return repos;
}

/** New repos (created in the window) that already collected many stars, per topic and overall. */
export async function discoverRising(
  opts: { days?: number; minStars?: number; topics?: string[] } = {},
) {
  const since = new Date(Date.now() - (opts.days ?? 30) * 86400_000).toISOString().slice(0, 10);
  const queries = [
    `stars:>=${opts.minStars ?? 500}+created:>${since}`,
    ...(opts.topics ?? []).map(
      (t) => `${encodeURIComponent(topicQuery(t))}+stars:>=100+created:>${since}`,
    ),
  ];
  let found = 0;
  for (const q of queries) {
    const body = await gh(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`);
    for (const r of body.items ?? []) {
      upsertRepo({
        fullName: r.full_name,
        description: r.description,
        language: r.language,
        topics: r.topics,
        stars: r.stargazers_count,
        forks: r.forks_count,
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
        via: 'rising',
      });
      found++;
    }
  }
  return found;
}

/** Refresh star counts of tracked repos (oldest refresh first) so weekly growth can be computed. */
export async function refreshRepoStats(limit = process.env.GITHUB_TOKEN ? 300 : 40) {
  const rows = getDb()
    .prepare(
      `SELECT full_name FROM repos WHERE refreshed_at IS NULL OR refreshed_at < :day ORDER BY (refreshed_at IS NOT NULL), refreshed_at LIMIT :limit`,
    )
    .all({ day: today(), limit }) as Row[];
  let refreshed = 0;
  for (const { full_name } of rows) {
    try {
      const r = await gh(`/repos/${full_name}`);
      upsertRepo({
        fullName: r.full_name,
        description: r.description,
        language: r.language,
        topics: r.topics,
        stars: r.stargazers_count,
        forks: r.forks_count,
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
      });
      refreshed++;
    } catch (e) {
      if (String(e).includes('limite')) break;
      getDb()
        .prepare('UPDATE repos SET refreshed_at = :at WHERE full_name = :n')
        .run({ at: now(), n: full_name }); // 404: don't retry today
    }
  }
  return refreshed;
}

/** Daily job: trending (overall + the user's languages), rising new repos, mentions, star refresh. */
export async function collectGithub() {
  const profile = getProfile();
  const catalogLangs = [
    'Python',
    'JavaScript',
    'TypeScript',
    'Go',
    'Rust',
    'Java',
    'Kotlin',
    'C#',
    'C++',
    'C',
    'Ruby',
    'PHP',
    'Swift',
    'Dart',
    'Elixir',
    'Zig',
    'Scala',
  ];
  const langs = profile.technologies.filter((t) => catalogLangs.includes(t)).slice(0, 5);
  const report = { trending: 0, rising: 0, mentions: 0, refreshed: 0, errors: [] as string[] };
  for (const [since, language] of [
    ['daily', undefined],
    ['weekly', undefined],
    ...langs.map((l) => ['weekly', l]),
  ] as ['daily' | 'weekly', string | undefined][]) {
    try {
      report.trending += (await fetchTrending({ since, language })).length;
    } catch (e) {
      report.errors.push(String(e));
    }
  }
  try {
    report.rising = await discoverRising({
      topics: profile.interests
        .filter((i) => i.priority === 'high')
        .map((i) => i.name)
        .slice(0, 4),
    });
  } catch (e) {
    report.errors.push(String(e));
  }
  report.mentions = scanMentions();
  report.refreshed = await refreshRepoStats();
  return report;
}

// ─── Read ───────────────────────────────────────────────────────────────────

export interface RepoView extends Repo {
  gained7d: number | null;
  /** From github.com/trending: "N stars today / this week" (fresh within 48h). */
  trending: { gain: number; period: 'daily' | 'weekly' } | null;
  history: { day: string; stars: number }[];
  mentions: {
    contentId: string;
    creatorId: string | null;
    creatorName: string | null;
    title: string;
    at: string;
  }[];
  inStack: boolean;
}

export function listTrendingRepos(
  opts: {
    scope?: 'all' | 'stack' | 'posted';
    sort?: 'gained' | 'stars' | 'new';
    limit?: number;
  } = {},
): RepoView[] {
  const db = getDb();
  const profile = getProfile();
  const stack = new Set(
    [...profile.technologies, ...profile.interests.map((i) => i.name)].map((s) => s.toLowerCase()),
  );
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
  const snaps = new Map<string, { day: string; stars: number }[]>();
  for (const s of db
    .prepare('SELECT full_name, day, stars FROM repo_snapshots WHERE day >= :m ORDER BY day')
    .all({ m: monthAgo }) as Row[]) {
    const k = s.full_name.toLowerCase();
    snaps.set(k, [...(snaps.get(k) ?? []), { day: s.day, stars: s.stars }]);
  }
  const mentions = new Map<string, RepoView['mentions']>();
  for (const m of db
    .prepare(
      `SELECT rm.full_name, rm.content_id, rm.creator_id, rm.at, c.title, cr.name AS creator_name
       FROM repo_mentions rm JOIN contents c ON c.id = rm.content_id LEFT JOIN creators cr ON cr.id = rm.creator_id ORDER BY rm.at DESC`,
    )
    .all() as Row[]) {
    const k = m.full_name.toLowerCase();
    mentions.set(k, [
      ...(mentions.get(k) ?? []),
      {
        contentId: m.content_id,
        creatorId: m.creator_id,
        creatorName: m.creator_name,
        title: m.title,
        at: m.at,
      },
    ]);
  }
  const recent = new Date(Date.now() - 48 * 3600_000).toISOString();
  const trendRows = new Map(
    (
      db
        .prepare(
          'SELECT full_name, trending_gain, trending_period FROM repos WHERE trending_at >= :r AND trending_gain > 0',
        )
        .all({ r: recent }) as Row[]
    ).map((x) => [
      x.full_name.toLowerCase(),
      { gain: x.trending_gain as number, period: x.trending_period as 'daily' | 'weekly' },
    ]),
  );
  const views = (db.prepare('SELECT * FROM repos WHERE stars > 0').all() as Row[])
    .map(toRepo)
    .map((r): RepoView => {
      const k = r.fullName.toLowerCase();
      const trending = trendRows.get(k) ?? null;
      const h = snaps.get(k) ?? [];
      const base = h.find((x) => x.day >= weekAgo) ?? null;
      const last = h.at(-1);
      // New repos: all their stars were gained recently.
      const young = r.createdAt && Date.now() - Date.parse(r.createdAt) < 7 * 86400_000;
      const measured = young
        ? r.stars
        : base && last && base.day !== last.day
          ? last.stars - base.stars
          : null;
      // Until a week of snapshots exists, the weekly trending figure is the best estimate.
      const gained7d =
        measured ??
        (trending?.period === 'weekly' ? trending.gain : trending ? trending.gain * 7 : null);
      const hay = [r.language ?? '', ...r.topics, r.description ?? ''].join(' ').toLowerCase();
      const inStack = [...stack].some(
        (s) =>
          s.length > 1 &&
          (r.topics.includes(s.replace(/\s+/g, '-')) ||
            (r.language ?? '').toLowerCase() === s ||
            hay.includes(s)),
      );
      return { ...r, gained7d, trending, history: h, mentions: mentions.get(k) ?? [], inStack };
    });
  const scoped = views.filter((r) =>
    opts.scope === 'stack'
      ? r.inStack
      : opts.scope === 'posted'
        ? r.mentions.some((m) => m.creatorId)
        : true,
  );
  const sort = opts.sort ?? 'gained';
  scoped.sort((a, b) =>
    sort === 'stars'
      ? b.stars - a.stars
      : sort === 'new'
        ? (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
        : (b.gained7d ?? -1) - (a.gained7d ?? -1) || b.stars - a.stars,
  );
  return scoped.slice(0, opts.limit ?? 50);
}

export function annotateRepo(fullName: string, whyItMatters: string): void {
  getDb()
    .prepare('UPDATE repos SET why_it_matters = :w WHERE full_name = :n')
    .run({ n: fullName, w: whyItMatters });
}

export function trackRepos(fullNames: string[], via = 'agent') {
  for (const n of fullNames)
    upsertRepo({ fullName: n.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''), via });
  return { tracked: fullNames.length };
}
