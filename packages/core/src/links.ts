import { discoverSource, topicSources } from './discover';
import { ingestSources } from './ingest';
import {
  addDiscoveredContent,
  getProfile,
  listGoals,
  listSources,
  setSourceEnabled,
  upsertSource,
} from './repo';
import type { Platform, Source } from './types';

export interface AddLinkResult {
  source: Source;
  via: string;
  created: boolean;
  collected: number;
  itemAdded: boolean;
  error: string | null;
  platform: Platform;
  handle: string | null;
}

/**
 * "Se eu enviar um link, inclua aquele site como fonte": detects the best way to follow the
 * site, registers it, collects it right away, and also queues the link itself when it is an
 * article/video.
 */
export async function addLink(
  url: string,
  opts: { creatorId?: string | null } = {},
): Promise<AddLinkResult> {
  const d = await discoverSource(url, { rsshubUrl: getProfile().rsshubUrl });
  const existed = listSources().find((s) => s.url === d.url);
  const source = upsertSource({
    kind: d.kind,
    name: existed?.name ?? d.name,
    url: d.url,
    defaultArea: d.defaultArea,
    everyMinutes: d.everyMinutes,
    origin: existed?.origin ?? 'link',
    platform: d.platform,
    creatorId: opts.creatorId ?? existed?.creatorId ?? null,
    enabled: true,
  });
  let collected = 0;
  let error: string | null = null;
  if (d.kind !== 'page' && d.kind !== 'social') {
    const [r] = await ingestSources({ sourceIds: [source.id] });
    collected = r?.inserted ?? 0;
    error = r?.error ?? null;
  }
  const itemAdded = d.isItem
    ? addDiscoveredContent(
        [{ url, title: d.itemTitle ?? url, creatorId: source.creatorId }],
        'link',
      ).inserted > 0
    : false;
  return {
    source,
    via: d.via,
    created: !existed,
    collected,
    itemAdded,
    error,
    platform: d.platform,
    handle: d.handle,
  };
}

/**
 * Autonomous search (deterministic half): every high/medium interest and every active goal gets
 * a Hacker News query and a GitHub repository search. Removing an interest disables its sources.
 * The agent does the other half with WebSearch (videos, tutorials, articles).
 */
export function syncTopicSources(): { enabled: number; disabled: number } {
  const profile = getProfile();
  const topics = new Set(profile.interests.filter((i) => i.priority !== 'low').map((i) => i.name));
  const wanted = new Map<string, ReturnType<typeof topicSources>[number] & { topic: string }>();
  for (const t of topics) for (const s of topicSources(t)) wanted.set(s.url, { ...s, topic: t });

  // GitHub's unauthenticated search allows ~10 requests/minute: keep the high-priority topics first.
  const high = new Set(profile.interests.filter((i) => i.priority === 'high').map((i) => i.name));
  const gh = [...wanted.values()]
    .filter((s) => s.kind === 'github_search')
    .sort((a, b) => Number(high.has(b.topic)) - Number(high.has(a.topic)));
  for (const s of gh.slice(6)) wanted.delete(s.url);

  let enabled = 0;
  let disabled = 0;
  for (const s of wanted.values()) {
    upsertSource({ ...s, origin: 'interest', enabled: true });
    enabled++;
  }
  for (const s of listSources()) {
    if (s.origin === 'interest' && !wanted.has(s.url) && s.enabled) {
      setSourceEnabled(s.id, false);
      disabled++;
    }
  }
  void listGoals; // goals are searched by the agent (WebSearch), not by fixed queries
  return { enabled, disabled };
}
