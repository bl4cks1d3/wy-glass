// Graph views over the brain: how knowledge connects, and which sources feed it.
import { getDb } from './db';
import {
  listGoals,
  listKnowledge,
  listLearningPaths,
  listProjects,
  listSources,
  projectProgress,
} from './repo';

export type GraphNodeKind = 'knowledge' | 'content' | 'project' | 'goal' | 'source' | 'area';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Visual weight (radius driver): confidence, relevant items, progress… */
  weight: number;
  /** Status / tone hint for the color: ok | accent | faint | ai | warn | err | fg. */
  tone: 'ok' | 'accent' | 'faint' | 'ai' | 'warn' | 'err' | 'fg';
  sub?: string;
  href?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type Row = Record<string, any>;
const parse = <T>(v: unknown, f: T): T => {
  try {
    return typeof v === 'string' ? ((JSON.parse(v) as T) ?? f) : f;
  } catch {
    return f;
  }
};

const K = (name: string) => `k:${name.toLowerCase()}`;

/** Concepts + the content, projects and goals that touch them. */
export function getKnowledgeGraph(opts: { contentDays?: number; maxContent?: number } = {}): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const edge = (a: string, b: string, w = 1) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    const key = [a, b].sort().join('|');
    const e = edges.get(key);
    if (e) e.weight += w;
    else edges.set(key, { source: a, target: b, weight: w });
  };
  const ensureConcept = (name: string) => {
    const id = K(name);
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        kind: 'knowledge',
        label: name,
        weight: 0,
        tone: 'faint',
        sub: 'Mencionado',
        href: `/knowledge?k=${encodeURIComponent(name)}`,
      });
    return id;
  };

  const knowledge = listKnowledge();
  for (const k of knowledge) {
    const tone =
      k.status === 'MASTERED' || k.status === 'APPLIED'
        ? 'ok'
        : k.status === 'DISCOVERED'
          ? k.gapReason
            ? 'warn'
            : 'faint'
          : 'accent';
    nodes.set(K(k.name), {
      id: K(k.name),
      kind: 'knowledge',
      label: k.name,
      weight: k.confidence,
      tone,
      sub: k.gapReason ? 'Lacuna' : k.status,
      href: `/knowledge?k=${encodeURIComponent(k.name)}`,
    });
  }
  for (const k of knowledge) for (const r of k.related) edge(K(k.name), ensureConcept(r), 2);

  for (const p of listProjects()) {
    const id = `p:${p.id}`;
    nodes.set(id, {
      id,
      kind: 'project',
      label: p.name,
      weight: projectProgress(p) / 10,
      tone: 'fg',
      sub: p.status,
      href: `/build?p=${p.id}`,
    });
    for (const x of p.prerequisites) edge(id, ensureConcept(x.name), 2);
  }

  const paths = new Map(listLearningPaths().map((p) => [p.id, p]));
  for (const g of listGoals({ status: ['new', 'planning', 'active'] })) {
    const id = `g:${g.id}`;
    nodes.set(id, {
      id,
      kind: 'goal',
      label: g.text.length > 48 ? g.text.slice(0, 46) + '…' : g.text,
      weight: 4,
      tone: 'ai',
      sub: 'Meta',
      href: '/learn',
    });
    for (const m of (g.pathId && paths.get(g.pathId)?.modules) || [])
      edge(id, ensureConcept(m.title), 2);
  }

  const since = new Date(Date.now() - (opts.contentDays ?? 14) * 86400_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT id, title, area, priority, related_knowledge FROM contents
       WHERE status = 'analyzed' AND user_state != 'IGNORED' AND analyzed_at >= :since AND related_knowledge != '[]'
       ORDER BY priority, analyzed_at DESC LIMIT :limit`,
    )
    .all({ since, limit: opts.maxContent ?? 60 }) as Row[];
  for (const r of rows) {
    const id = `c:${r.id}`;
    nodes.set(id, {
      id,
      kind: 'content',
      label: r.title.length > 60 ? r.title.slice(0, 58) + '…' : r.title,
      weight: r.priority === 'P0' ? 3 : r.priority === 'P1' ? 2 : 1,
      tone: r.priority === 'P0' ? 'err' : 'fg',
      sub: r.area,
      href: `/content/${r.id}`,
    });
    for (const name of parse<string[]>(r.related_knowledge, [])) edge(id, ensureConcept(name), 1);
  }

  // Concepts only mentioned once and not connected to anything else add noise.
  const degree = new Map<string, number>();
  for (const e of edges.values())
    for (const n of [e.source, e.target]) degree.set(n, (degree.get(n) ?? 0) + 1);
  for (const [id, n] of nodes)
    if (n.kind === 'knowledge' && n.sub === 'Mencionado' && (degree.get(id) ?? 0) < 2)
      nodes.delete(id);
  const alive = [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target));
  return { nodes: [...nodes.values()], edges: alive };
}

export interface SourceStats {
  id: string;
  name: string;
  kind: string;
  origin: string;
  enabled: boolean;
  total: number;
  relevant: number;
  ignored: number;
  saved: number;
  last7d: number;
  /** relevant / triaged — how much of what this source brings survives curation. */
  signal: number;
}

export function getSourceStats(): SourceStats[] {
  const rows = getDb()
    .prepare(
      `SELECT source_id,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'analyzed' AND priority IN ('P0','P1','P2') THEN 1 ELSE 0 END) AS relevant,
        SUM(CASE WHEN status IN ('ignored','duplicate') THEN 1 ELSE 0 END) AS ignored,
        SUM(CASE WHEN status != 'pending' THEN 1 ELSE 0 END) AS triaged,
        SUM(CASE WHEN user_state = 'SAVED' THEN 1 ELSE 0 END) AS saved,
        SUM(CASE WHEN retrieved_at >= :week THEN 1 ELSE 0 END) AS last7d
       FROM contents GROUP BY source_id`,
    )
    .all({ week: new Date(Date.now() - 7 * 86400_000).toISOString() }) as Row[];
  const by = new Map(rows.map((r) => [r.source_id, r]));
  return listSources()
    .filter((s) => !s.url.startsWith('demo://'))
    .map((s) => {
      const r = by.get(s.id) ?? {};
      const triaged = Number(r.triaged ?? 0);
      return {
        id: s.id,
        name: s.name,
        kind: s.kind,
        origin: s.origin,
        enabled: s.enabled,
        total: Number(r.total ?? 0),
        relevant: Number(r.relevant ?? 0),
        ignored: Number(r.ignored ?? 0),
        saved: Number(r.saved ?? 0),
        last7d: Number(r.last7d ?? 0),
        signal: triaged ? Math.round((Number(r.relevant ?? 0) / triaged) * 100) : 0,
      };
    })
    .sort((a, b) => b.relevant - a.relevant || b.total - a.total);
}

/** Sources → the concepts their relevant items touched (edge weight = number of items). */
export function getSourceGraph(): Graph {
  const stats = getSourceStats();
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const s of stats) {
    if (!s.enabled && !s.total) continue;
    const tone =
      s.origin === 'interest'
        ? 'ai'
        : s.origin === 'link' || s.origin === 'user'
          ? 'accent'
          : s.origin === 'agent'
            ? 'warn'
            : 'fg';
    nodes.set(`s:${s.id}`, {
      id: `s:${s.id}`,
      kind: 'source',
      label: s.name,
      weight: Math.min(10, s.relevant),
      tone,
      sub: `${s.relevant} relevantes · ${s.signal}% sinal`,
      href: '/settings',
    });
  }
  const known = new Map(listKnowledge().map((k) => [k.name.toLowerCase(), k]));

  // Structural hubs so the graph is readable before any analysis: source → topic → area.
  const AREA: Record<string, string> = {
    now: 'Now',
    learn: 'Learn',
    build: 'Build',
    frontier: 'Frontier',
  };
  const meta = new Map(listSources().map((s) => [s.id, s]));
  for (const id of [...nodes.keys()]) {
    const src = meta.get(id.slice(2));
    if (!src) continue;
    if (src.defaultArea) {
      const aid = `a:${src.defaultArea}`;
      if (!nodes.has(aid))
        nodes.set(aid, {
          id: aid,
          kind: 'area',
          label: AREA[src.defaultArea],
          weight: 8,
          tone: 'fg',
          sub: 'Área',
          href: `/${src.defaultArea === 'now' ? 'now' : src.defaultArea}`,
        });
      edges.set(`${id}|${aid}`, { source: id, target: aid, weight: 1 });
    }
    if (src.topic) {
      const tid = K(src.topic);
      const k = known.get(src.topic.toLowerCase());
      if (!nodes.has(tid))
        nodes.set(tid, {
          id: tid,
          kind: 'knowledge',
          label: src.topic,
          weight: k?.confidence ?? 3,
          tone: k ? 'accent' : 'ai',
          sub: 'Tema acompanhado',
          href: `/knowledge?k=${encodeURIComponent(src.topic)}`,
        });
      edges.set(`${id}|${tid}`, { source: id, target: tid, weight: 2 });
    }
  }

  const rows = getDb()
    .prepare(
      `SELECT source_id, related_knowledge, area FROM contents WHERE status = 'analyzed' AND related_knowledge != '[]'`,
    )
    .all() as Row[];
  for (const r of rows) {
    const sid = `s:${r.source_id}`;
    if (!nodes.has(sid)) continue;
    for (const name of parse<string[]>(r.related_knowledge, [])) {
      const k = known.get(name.toLowerCase());
      const kid = K(name);
      if (!nodes.has(kid))
        nodes.set(kid, {
          id: kid,
          kind: 'knowledge',
          label: k?.name ?? name,
          weight: k?.confidence ?? 0,
          tone: !k
            ? 'faint'
            : k.status === 'MASTERED' || k.status === 'APPLIED'
              ? 'ok'
              : k.status === 'DISCOVERED'
                ? 'faint'
                : 'accent',
          sub: k?.status ?? 'Mencionado',
          href: `/knowledge?k=${encodeURIComponent(k?.name ?? name)}`,
        });
      const key = `${sid}|${kid}`;
      const e = edges.get(key);
      if (e) e.weight++;
      else edges.set(key, { source: sid, target: kid, weight: 1 });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
