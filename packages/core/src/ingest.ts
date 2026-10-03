// Ingestion engine (PTR RF-006): deterministic fetch + normalize, no AI.
// The curator agent runs this through the MCP tool `ingest_sources`, then analyzes the pending items.
import { XMLParser } from 'fast-xml-parser';
import { insertRawContent, listSources, markSourceFetched, type RawItem } from './repo';
import type { Source } from './types';

const UA = 'MyCurrentBrain/0.1 (+personal technical intelligence)';
const MAX_ITEMS_PER_SOURCE = 30;

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i)); // backoff
    }
  }
  throw lastErr;
}

const stripHtml = (s: unknown) =>
  typeof s === 'string'
    ? s
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000)
    : null;

const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object))
    return String((v as Record<string, unknown>)['#text']);
  return null;
};

const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

const toIso = (d: string | null) => {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString();
};

function parseFeed(xml: string, source: Source): RawItem[] {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' }).parse(xml);
  // RSS 2.0
  const rssItems = asArray(doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item);
  if (rssItems.length) {
    return rssItems.slice(0, MAX_ITEMS_PER_SOURCE).map((it: any) => {
      const link = text(it.link) ?? '';
      return {
        sourceId: source.id,
        externalId: text(it.guid) ?? link ?? text(it.title) ?? '',
        url: link,
        title: stripHtml(text(it.title)) ?? '(untitled)',
        author: text(it['dc:creator']) ?? text(it.author),
        publishedAt: toIso(text(it.pubDate) ?? text(it['dc:date'])),
        excerpt: stripHtml(text(it.description) ?? text(it['content:encoded'])),
      };
    });
  }
  // Atom (also GitHub releases.atom)
  const entries = asArray(doc?.feed?.entry);
  return entries.slice(0, MAX_ITEMS_PER_SOURCE).map((e: any) => {
    const links = asArray(e.link);
    const alt = links.find((l: any) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
    const url = typeof alt === 'string' ? alt : (alt?.['@href'] ?? '');
    return {
      sourceId: source.id,
      externalId: text(e.id) ?? url,
      url,
      title: stripHtml(text(e.title)) ?? '(untitled)',
      author: text(asArray(e.author)[0]?.name ?? null),
      publishedAt: toIso(text(e.published) ?? text(e.updated)),
      // YouTube puts the description under media:group
      excerpt: stripHtml(
        text(e.summary) ?? text(e.content) ?? text(e['media:group']?.['media:description']),
      ),
    };
  });
}

/** GitHub repository search — autonomous discovery of new projects by topic. */
async function fetchGithubSearch(source: Source): Promise<RawItem[]> {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const body = JSON.parse(await fetchWithRetry(source.url.replace('{since}', since)));
  return (body.items ?? []).map((r: any) => ({
    sourceId: source.id,
    externalId: String(r.id),
    url: r.html_url,
    title: `${r.full_name}${r.description ? ` — ${r.description}` : ''}`.slice(0, 300),
    author: r.owner?.login ?? null,
    publishedAt: r.created_at ?? null,
    excerpt: `★ ${r.stargazers_count} · ${r.language ?? '?'} · topics: ${(r.topics ?? []).join(', ') || '—'} · ${r.description ?? ''}`,
  }));
}

async function fetchHackerNews(source: Source): Promise<RawItem[]> {
  const body = JSON.parse(await fetchWithRetry(source.url));
  return (body.hits ?? []).slice(0, MAX_ITEMS_PER_SOURCE).map((h: any) => ({
    sourceId: source.id,
    externalId: String(h.objectID),
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    title: h.title ?? '(untitled)',
    author: h.author ?? null,
    publishedAt: h.created_at ?? null,
    excerpt: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · https://news.ycombinator.com/item?id=${h.objectID}`,
  }));
}

export interface IngestReport {
  source: string;
  fetched: number;
  inserted: number;
  error: string | null;
}

const isDue = (s: Source) =>
  !s.lastFetchedAt || Date.now() - new Date(s.lastFetchedAt).getTime() >= s.everyMinutes * 60_000;

/**
 * Failures in one source never stop the others (PTR RNF-006).
 * Sources fetched more recently than their cadence are skipped unless `force`.
 */
export async function ingestSources(
  opts: { sourceIds?: string[]; force?: boolean } = {},
): Promise<IngestReport[]> {
  // "page" sources have no feed: the agent visits them (list_due_pages).
  const sources = listSources({ enabledOnly: true })
    .filter((s) => s.kind !== 'page' && s.kind !== 'social')
    .filter((s) => !opts.sourceIds?.length || opts.sourceIds.includes(s.id))
    .filter((s) => opts.force || opts.sourceIds?.length || isDue(s));
  return Promise.all(
    sources.map(async (s): Promise<IngestReport> => {
      try {
        const raw =
          s.kind === 'hn'
            ? await fetchHackerNews(s)
            : s.kind === 'github_search'
              ? await fetchGithubSearch(s)
              : parseFeed(await fetchWithRetry(s.url), s);
        const items = raw.filter((i) => i.url && i.externalId);
        const { inserted } = insertRawContent(items);
        markSourceFetched(s.id, null);
        return { source: s.name, fetched: items.length, inserted, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markSourceFetched(s.id, msg);
        return { source: s.name, fetched: 0, inserted: 0, error: msg };
      }
    }),
  );
}
