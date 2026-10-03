// Turns any link the user sends into something the brain can keep collecting from.
//   github.com/o/r          → releases.atom
//   youtube channel/@handle → videos.xml?channel_id=…  (playlist → playlist_id)
//   reddit.com/r/x          → /.rss
//   blog / site             → <link rel="alternate"> or common feed paths
//   anything else           → a "page" source the agent checks with WebFetch
import { XMLParser } from 'fast-xml-parser';
import type { Area, Platform, SourceKind } from './types';

const UA = 'Mozilla/5.0 (compatible; MyCurrentBrain/0.1)';

export interface DiscoveredSource {
  kind: SourceKind;
  platform: Platform;
  /** @handle / channel name when the link is a profile. */
  handle: string | null;
  name: string;
  url: string;
  defaultArea: Area;
  everyMinutes: number;
  /** How it was detected, shown to the user. */
  via: string;
  /** The link itself looks like a single article/video worth reading now. */
  isItem: boolean;
  itemTitle: string | null;
}

async function get(url: string): Promise<{ body: string; type: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return {
      body: await res.text(),
      type: res.headers.get('content-type') ?? '',
      finalUrl: res.url || url,
    };
  } catch {
    return null;
  }
}

const looksLikeFeed = (body: string) =>
  /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(body);

function feedTitle(xml: string): string | null {
  try {
    const d = new XMLParser({ ignoreAttributes: true }).parse(xml);
    const t = d?.rss?.channel?.title ?? d?.feed?.title ?? d?.['rdf:RDF']?.channel?.title;
    return typeof t === 'string' ? t : (t?.['#text'] ?? null);
  } catch {
    return null;
  }
}

const htmlTitle = (html: string) =>
  html
    .match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim() ?? null;
const metaContent = (html: string, prop: string) =>
  html.match(
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
  )?.[1] ??
  html.match(
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
  )?.[1] ??
  null;

function alternateFeeds(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag))
      continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) {
      try {
        out.push(new URL(href.replace(/&amp;/g, '&'), base).toString());
      } catch {}
    }
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const SOCIAL_HOSTS: Record<string, Platform> = {
  'instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'x.com': 'x',
  'twitter.com': 'x',
  'threads.net': 'threads',
  'threads.com': 'threads',
  'linkedin.com': 'linkedin',
  'twitch.tv': 'twitch',
  'kick.com': 'kick',
};

/**
 * RSSHub routes (https://docs.rsshub.app) for platforms without public feeds.
 * Only used when the user configured their own instance — the public one is bot-protected.
 */
const RSSHUB_ROUTE: Partial<Record<Platform, (handle: string) => string>> = {
  instagram: (h) => `/picuki/profile/${h}`,
  tiktok: (h) => `/tiktok/user/@${h}`,
  x: (h) => `/twitter/user/${h}`,
  threads: (h) => `/threads/${h}`,
  twitch: (h) => `/twitch/video/${h}`,
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  threads: 'Threads',
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  linkedin: 'LinkedIn',
  twitch: 'Twitch',
  kick: 'Kick',
  vimeo: 'Vimeo',
  reddit: 'Reddit',
  github: 'GitHub',
  medium: 'Medium',
  devto: 'DEV',
  substack: 'Substack',
  podcast: 'Podcast',
  blog: 'Blog',
  web: 'Site',
};

const NOT_A_HANDLE = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'video',
  'status',
  'i',
  'home',
  'watch',
  'hashtag',
  'search',
]);

function socialHandle(platform: Platform, parts: string[]): string | null {
  if (platform === 'linkedin')
    return parts[0] === 'in' || parts[0] === 'company' ? (parts[1] ?? null) : null;
  const first = parts[0]?.replace(/^@/, '');
  return first && !NOT_A_HANDLE.has(first) ? first : null;
}

export async function discoverSource(
  raw: string,
  opts: { rsshubUrl?: string | null } = {},
): Promise<DiscoveredSource> {
  const input = new URL(raw.trim());
  const host = input.hostname.replace(/^www\.|^m\./, '');
  const parts = input.pathname.split('/').filter(Boolean);
  const isDeepPath = parts.length >= 2 || /\.(html?|php)$/.test(input.pathname);

  // Instagram, TikTok, X, Threads, LinkedIn, Twitch, Kick: no public feeds.
  const social = SOCIAL_HOSTS[host];
  if (social) {
    const handle = socialHandle(social, parts);
    const isPost =
      social === 'linkedin' ? parts[0] === 'posts' || parts[0] === 'feed' : parts.length >= 2;
    const label = PLATFORM_LABEL[social];
    const route = handle ? RSSHUB_ROUTE[social] : undefined;
    if (route && handle && opts.rsshubUrl) {
      return {
        kind: 'rss',
        platform: social,
        handle,
        name: `${label} · @${handle}`,
        url: opts.rsshubUrl.replace(/\/$/, '') + route(handle),
        defaultArea: 'now',
        everyMinutes: 180,
        via: 'Feed via o seu RSSHub',
        isItem: isPost,
        itemTitle: null,
      };
    }
    const canonicalHost = host === 'twitter.com' ? 'x.com' : host;
    const profileUrl = !handle
      ? input.toString()
      : social === 'tiktok'
        ? `https://www.tiktok.com/@${handle}`
        : social === 'linkedin'
          ? `https://www.linkedin.com/${parts[0]}/${handle}`
          : `https://www.${canonicalHost}/${handle}`;
    return {
      kind: 'social',
      platform: social,
      handle,
      name: handle ? `${label} · @${handle}` : label,
      url: profileUrl,
      defaultArea: 'now',
      everyMinutes: 1440,
      via: `${label} não tem feed público: o agente procura os posts novos na coleta diária${RSSHUB_ROUTE[social] ? ' (ou configure um RSSHub em Ajustes)' : ''}`,
      isItem: isPost,
      itemTitle: null,
    };
  }

  // Bluesky, Mastodon/Fediverse, Medium, DEV and Substack expose RSS per author
  if (host === 'bsky.app' && parts[0] === 'profile' && parts[1])
    return {
      kind: 'rss',
      platform: 'bluesky',
      handle: parts[1],
      name: `Bluesky · @${parts[1]}`,
      url: `https://bsky.app/profile/${parts[1]}/rss`,
      defaultArea: 'now',
      everyMinutes: 120,
      via: 'Feed do perfil no Bluesky',
      isItem: parts[2] === 'post',
      itemTitle: null,
    };
  if (host === 'medium.com' && parts[0]?.startsWith('@'))
    return {
      kind: 'rss',
      platform: 'medium',
      handle: parts[0].slice(1),
      name: `Medium · ${parts[0]}`,
      url: `https://medium.com/feed/${parts[0]}`,
      defaultArea: 'now',
      everyMinutes: 360,
      via: 'Feed do autor no Medium',
      isItem: parts.length >= 2,
      itemTitle: null,
    };
  if (host === 'dev.to' && parts[0])
    return {
      kind: 'rss',
      platform: 'devto',
      handle: parts[0],
      name: `DEV · ${parts[0]}`,
      url: `https://dev.to/feed/${parts[0]}`,
      defaultArea: 'now',
      everyMinutes: 360,
      via: 'Feed do autor no DEV',
      isItem: parts.length >= 2,
      itemTitle: null,
    };
  if (host.endsWith('.substack.com'))
    return {
      kind: 'rss',
      platform: 'substack',
      handle: host.split('.')[0],
      name: `Substack · ${host.split('.')[0]}`,
      url: `https://${host}/feed`,
      defaultArea: 'now',
      everyMinutes: 360,
      via: 'Feed da newsletter no Substack',
      isItem: parts[0] === 'p',
      itemTitle: null,
    };
  if (host === 'vimeo.com' && parts[0] && !/^\d+$/.test(parts[0]))
    return {
      kind: 'rss',
      platform: 'vimeo',
      handle: parts[0],
      name: `Vimeo · ${parts[0]}`,
      url:
        parts[0] === 'channels' && parts[1]
          ? `https://vimeo.com/channels/${parts[1]}/videos/rss`
          : `https://vimeo.com/${parts[0]}/videos/rss`,
      defaultArea: 'learn',
      everyMinutes: 720,
      via: 'Feed de vídeos do Vimeo',
      isItem: false,
      itemTitle: null,
    };
  if (
    parts[0]?.startsWith('@') &&
    parts.length <= 2 &&
    !['youtube.com', 'youtu.be'].includes(host)
  ) {
    const feed = `${input.origin}/${parts[0]}.rss`;
    const f = await get(feed);
    if (f && looksLikeFeed(f.body))
      return {
        kind: 'rss',
        platform: 'mastodon',
        handle: parts[0].slice(1),
        name: `Mastodon · ${parts[0]}@${host}`,
        url: feed,
        defaultArea: 'now',
        everyMinutes: 120,
        via: 'Feed do perfil no Mastodon/Fediverso',
        isItem: parts.length === 2,
        itemTitle: null,
      };
  }

  // GitHub repository → releases feed
  if (host === 'github.com' && parts.length >= 2) {
    const [owner, repo] = parts;
    return {
      kind: 'rss',
      platform: 'github',
      handle: owner,
      name: `Releases · ${repo}`,
      url: `https://github.com/${owner}/${repo}/releases.atom`,
      defaultArea: 'now',
      everyMinutes: 60,
      via: 'Releases do repositório no GitHub',
      isItem: false,
      itemTitle: null,
    };
  }

  // Reddit subreddit
  if (host === 'reddit.com' && parts[0] === 'r' && parts[1]) {
    return {
      kind: 'rss',
      platform: 'reddit',
      handle: parts[1],
      name: `r/${parts[1]}`,
      url: `https://www.reddit.com/r/${parts[1]}/.rss`,
      defaultArea: 'now',
      everyMinutes: 120,
      via: 'Feed do subreddit',
      isItem: parts.length > 3,
      itemTitle: null,
    };
  }

  // YouTube: playlist, channel id, or @handle / video (resolve channel from the page)
  if (host === 'youtube.com' || host === 'youtu.be') {
    const list = input.searchParams.get('list');
    if (list)
      return {
        kind: 'rss',
        platform: 'youtube',
        handle: null,
        name: 'Playlist do YouTube',
        url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`,
        defaultArea: 'learn',
        everyMinutes: 360,
        via: 'Feed da playlist do YouTube',
        isItem: false,
        itemTitle: null,
      };
    let channelId = parts[0] === 'channel' ? parts[1] : null;
    let name = 'Canal do YouTube';
    const isVideo = host === 'youtu.be' || parts[0] === 'watch' || parts[0] === 'shorts';
    let itemTitle: string | null = null;
    const page = await get(input.toString());
    if (page) {
      // The page's own channel first: other "channelId"s on the page belong to related channels.
      const own = [
        /"externalId":"(UC[\w-]{20,})"/,
        /<meta itemprop="identifier" content="(UC[\w-]{20,})"/,
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{20,})"/,
        /application\/rss\+xml"[^>]*channel_id=(UC[\w-]{20,})/,
        /"videoDetails":\{[^}]*?"channelId":"(UC[\w-]{20,})"/,
        /<meta itemprop="channelId" content="(UC[\w-]{20,})"/,
      ];
      channelId ??= own.map((re) => page.body.match(re)?.[1]).find(Boolean) ?? null;
      const author =
        page.body.match(/"author":"([^"]+)"/)?.[1] ??
        page.body.match(/<link itemprop="name" content="([^"]+)"/)?.[1];
      const t = metaContent(page.body, 'og:title');
      if (isVideo) itemTitle = t ? decode(t) : null;
      name = author
        ? `YouTube · ${decode(author)}`
        : t && !isVideo
          ? `YouTube · ${decode(t)}`
          : name;
    }
    if (channelId)
      return {
        kind: 'rss',
        platform: 'youtube',
        handle: parts[0]?.startsWith('@') ? parts[0].slice(1) : null,
        name,
        url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
        defaultArea: 'learn',
        everyMinutes: 360,
        via: 'Feed do canal do YouTube',
        isItem: isVideo,
        itemTitle,
      };
  }

  const page = await get(input.toString());
  if (page && (looksLikeFeed(page.body) || /xml/.test(page.type))) {
    return {
      kind: 'rss',
      platform: 'blog',
      handle: null,
      name: feedTitle(page.body) ?? host,
      url: page.finalUrl,
      defaultArea: 'now',
      everyMinutes: 60,
      via: 'O link já é um feed',
      isItem: false,
      itemTitle: null,
    };
  }

  const base = page?.finalUrl ?? input.toString();
  const origin = new URL(base).origin;
  const siteName = (page && (metaContent(page.body, 'og:site_name') ?? null)) || host;
  const pageTitle = page ? (metaContent(page.body, 'og:title') ?? htmlTitle(page.body)) : null;

  // <link rel="alternate"> on the page, then on the site root
  let candidates = page ? alternateFeeds(page.body, base) : [];
  if (!candidates.length && isDeepPath) {
    const root = await get(origin);
    if (root) candidates = alternateFeeds(root.body, origin);
  }
  // Common feed locations
  const guesses = [
    '/feed',
    '/feed.atom',
    '/rss.xml',
    '/atom.xml',
    '/feed.xml',
    '/index.xml',
    '/rss',
    '/atom',
    '/index.rss',
    '/blog/feed',
    '/blog/rss.xml',
    '/feeds/posts/default',
  ].map((p) => origin + p);
  for (const url of [...candidates, ...guesses]) {
    const f = await get(url);
    if (f && looksLikeFeed(f.body)) {
      return {
        kind: 'rss',
        platform: 'blog',
        handle: null,
        name: decode(feedTitle(f.body) ?? siteName),
        url: f.finalUrl,
        defaultArea: 'now',
        everyMinutes: 120,
        via: candidates.includes(url) ? 'Feed anunciado pelo site' : 'Feed encontrado no site',
        isItem: isDeepPath,
        itemTitle: pageTitle ? decode(pageTitle) : null,
      };
    }
  }

  // No feed: the agent will check the page itself
  return {
    kind: 'page',
    platform: 'web',
    handle: null,
    name: decode(siteName),
    url: isDeepPath ? origin : input.toString(),
    defaultArea: 'now',
    everyMinutes: 1440,
    via: 'Sem feed: o agente visita a página na coleta diária',
    isItem: isDeepPath,
    itemTitle: pageTitle ? decode(pageTitle) : null,
  };
}

// ─── Autonomous topic sources ───────────────────────────────────────────────

/** Interest names are pt-BR; HN/GitHub search works best in English. */
const QUERY: Record<string, string> = {
  'Local AI': 'local LLM',
  'LLM releases': 'LLM',
  'AI coding tools': 'AI coding',
  'Pesquisa em IA': 'AI research',
  Evals: 'LLM evaluation',
  'Linguagens novas': 'programming language',
  Arquitetura: 'software architecture',
  'Developer experience': 'developer experience',
  Observabilidade: 'observability',
  'Bancos de dados': 'database',
  'Engenharia de dados': 'data engineering',
  Segurança: 'security',
  'Vulnerabilidades (CVEs)': 'CVE vulnerability',
  'Supply chain': 'supply chain attack',
  Privacidade: 'privacy',
  Carreira: 'software engineering career',
  Produto: 'product engineering',
  'Liderança técnica': 'engineering management',
  'Platform engineering': 'platform engineering',
};

const GH_TOPIC: Record<string, string> = {
  'AI Agents': 'ai-agents',
  RAG: 'rag',
  'Local AI': 'local-llm',
  MCP: 'mcp',
  'AI coding tools': 'ai-coding',
  Evals: 'llm-evaluation',
  'Fine-tuning': 'fine-tuning',
  Multimodal: 'multimodal',
  Observabilidade: 'observability',
  Kubernetes: 'kubernetes',
  DevOps: 'devops',
  'Bancos de dados': 'database',
  Segurança: 'security',
  WebAssembly: 'webassembly',
};

export const topicQuery = (name: string) => QUERY[name] ?? name;

export function topicSources(name: string) {
  const q = encodeURIComponent(topicQuery(name));
  const out: {
    kind: SourceKind;
    name: string;
    url: string;
    defaultArea: Area;
    everyMinutes: number;
  }[] = [
    {
      kind: 'hn',
      name: `HN · ${name}`,
      defaultArea: 'now',
      everyMinutes: 180,
      url: `https://hn.algolia.com/api/v1/search_by_date?query=${q}&tags=story&numericFilters=points%3E%3D15&hitsPerPage=20`,
    },
  ];
  const topic = GH_TOPIC[name];
  // {since} is replaced at fetch time with a date 14 days ago.
  out.push({
    kind: 'github_search',
    name: `GitHub · ${name}`,
    defaultArea: 'frontier',
    everyMinutes: 1440,
    url: `https://api.github.com/search/repositories?q=${topic ? `topic:${topic}` : q}+created:%3E{since}&sort=stars&order=desc&per_page=10`,
  });
  return out;
}
