// Catch-up (deterministic half): pull the last N months of history for the user's stack so they
// can recover what they missed. Items are flagged `backfill` and stay out of the daily Now/pulse.
// The agent then curates them (plus WebSearch) into a milestone timeline per technology.
import { topicQuery } from './discover';
import { getProfile, insertRawContent, listSources, upsertSource, type RawItem } from './repo';

const UA = 'MyCurrentBrain/0.1 (+personal technical intelligence)';

/** Official repos for popular technologies (GitHub releases = the canonical changelog). */
export const TECH_REPOS: Record<string, string> = {
  'Next.js': 'vercel/next.js',
  React: 'facebook/react',
  'Node.js': 'nodejs/node',
  TypeScript: 'microsoft/TypeScript',
  Deno: 'denoland/deno',
  Bun: 'oven-sh/bun',
  Vue: 'vuejs/core',
  Nuxt: 'nuxt/nuxt',
  Svelte: 'sveltejs/svelte',
  SvelteKit: 'sveltejs/kit',
  Angular: 'angular/angular',
  Astro: 'withastro/astro',
  Remix: 'remix-run/remix',
  'React Router': 'remix-run/react-router',
  'Tailwind CSS': 'tailwindlabs/tailwindcss',
  Vite: 'vitejs/vite',
  Vitest: 'vitest-dev/vitest',
  Playwright: 'microsoft/playwright',
  'React Native': 'facebook/react-native',
  Expo: 'expo/expo',
  Flutter: 'flutter/flutter',
  Electron: 'electron/electron',
  Tauri: 'tauri-apps/tauri',
  FastAPI: 'fastapi/fastapi',
  Flask: 'pallets/flask',
  NestJS: 'nestjs/nest',
  Hono: 'honojs/hono',
  Fastify: 'fastify/fastify',
  'Spring Boot': 'spring-projects/spring-boot',
  Laravel: 'laravel/framework',
  'Ruby on Rails': 'rails/rails',
  Rust: 'rust-lang/rust',
  Kotlin: 'JetBrains/kotlin',
  Zig: 'ziglang/zig',
  Gleam: 'gleam-lang/gleam',
  Elixir: 'elixir-lang/elixir',
  Docker: 'moby/moby',
  Kubernetes: 'kubernetes/kubernetes',
  Helm: 'helm/helm',
  Terraform: 'hashicorp/terraform',
  OpenTofu: 'opentofu/opentofu',
  Pulumi: 'pulumi/pulumi',
  'GitHub Actions': 'actions/runner',
  ArgoCD: 'argoproj/argo-cd',
  Prometheus: 'prometheus/prometheus',
  Grafana: 'grafana/grafana',
  OpenTelemetry: 'open-telemetry/opentelemetry-collector',
  Redis: 'redis/redis',
  Valkey: 'valkey-io/valkey',
  ClickHouse: 'ClickHouse/ClickHouse',
  DuckDB: 'duckdb/duckdb',
  pgvector: 'pgvector/pgvector',
  Qdrant: 'qdrant/qdrant',
  Weaviate: 'weaviate/weaviate',
  Milvus: 'milvus-io/milvus',
  Chroma: 'chroma-core/chroma',
  Supabase: 'supabase/supabase',
  Prisma: 'prisma/prisma',
  Drizzle: 'drizzle-team/drizzle-orm',
  SQLAlchemy: 'sqlalchemy/sqlalchemy',
  Elasticsearch: 'elastic/elasticsearch',
  Neo4j: 'neo4j/neo4j',
  Ollama: 'ollama/ollama',
  vLLM: 'vllm-project/vllm',
  'llama.cpp': 'ggml-org/llama.cpp',
  Transformers: 'huggingface/transformers',
  PyTorch: 'pytorch/pytorch',
  TensorFlow: 'tensorflow/tensorflow',
  JAX: 'jax-ml/jax',
  'scikit-learn': 'scikit-learn/scikit-learn',
  LangChain: 'langchain-ai/langchain',
  LangGraph: 'langchain-ai/langgraph',
  LlamaIndex: 'run-llama/llama_index',
  DSPy: 'stanfordnlp/dspy',
  MCP: 'modelcontextprotocol/modelcontextprotocol',
  'Claude Code': 'anthropics/claude-code',
  'Claude Agent SDK': 'anthropics/claude-agent-sdk-python',
  Pandas: 'pandas-dev/pandas',
  Polars: 'pola-rs/polars',
  'Apache Spark': 'apache/spark',
  Kafka: 'apache/kafka',
  Airflow: 'apache/airflow',
  dbt: 'dbt-labs/dbt-core',
  Biome: 'biomejs/biome',
  ESLint: 'eslint/eslint',
  Storybook: 'storybookjs/storybook',
  'TanStack Query': 'TanStack/query',
  Zustand: 'pmndrs/zustand',
  'Three.js': 'mrdoob/three.js',
  Godot: 'godotengine/godot',
};

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return res.json();
}

const stripMd = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);

/** Keep x.y.0 releases (and non-semver tags); patches are noise when catching up. */
const isMilestoneTag = (tag: string) => {
  const m = tag.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return !m || !m[3] || m[3] === '0';
};

export interface BackfillReport {
  topic: string;
  repo: string | null;
  releases: number;
  discussions: number;
  articles: number;
  papers: number;
  questions: number;
  projects: number;
  errors: string[];
}

const AI_WORDS =
  /\b(ai|ia|llm|rag|agents?|embeddings?|fine-tuning|lora|diffusion|transformers?|ml|machine learning|mcp|evals?|multimodal|vision|speech|pytorch|tensorflow|jax|hugging|ollama|vllm|llama|langchain|langgraph|llamaindex|dspy)\b/i;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const soTag = (t: string) => t.toLowerCase().replace(/\s+/g, '-');

export async function backfillHistory(
  opts: { months?: number; topics?: string[] } = {},
): Promise<BackfillReport[]> {
  const months = Math.min(36, Math.max(1, opts.months ?? 24));
  const sinceMs = Date.now() - months * 30.44 * 86400_000;
  const profile = getProfile();
  const topics = opts.topics?.length
    ? opts.topics
    : [
        ...new Set([
          ...profile.technologies,
          ...profile.interests.filter((i) => i.priority !== 'low').map((i) => i.name),
        ]),
      ].slice(0, 20);

  const hn = upsertSource({
    kind: 'hn',
    name: 'Catch-up · Hacker News',
    url: 'agent://catchup-hn',
    origin: 'agent',
    enabled: false,
  });
  const devto = upsertSource({
    kind: 'rss',
    name: 'Catch-up · DEV',
    url: 'agent://catchup-devto',
    origin: 'agent',
    platform: 'devto',
    enabled: false,
  });
  const arxiv = upsertSource({
    kind: 'rss',
    name: 'Catch-up · arXiv',
    url: 'agent://catchup-arxiv',
    origin: 'agent',
    enabled: false,
  });
  const so = upsertSource({
    kind: 'rss',
    name: 'Catch-up · Stack Overflow',
    url: 'agent://catchup-stackoverflow',
    origin: 'agent',
    enabled: false,
  });
  const ghs = upsertSource({
    kind: 'github_search',
    name: 'Catch-up · GitHub',
    url: 'agent://catchup-github',
    origin: 'agent',
    platform: 'github',
    enabled: false,
  });
  const days = Math.round(months * 30.44);
  const sinceDay = new Date(sinceMs).toISOString().slice(0, 10);
  const token = process.env.GITHUB_TOKEN; // optional: raises the API limit from 60 to 5000 req/h
  const gh: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const reports: BackfillReport[] = [];

  // Sequential on purpose: GitHub and Algolia rate limits.
  for (const topic of topics) {
    const r: BackfillReport = {
      topic,
      repo: TECH_REPOS[topic] ?? null,
      releases: 0,
      discussions: 0,
      articles: 0,
      papers: 0,
      questions: 0,
      projects: 0,
      errors: [],
    };
    const attempt = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        r.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    await attempt('github', async () => {
      if (r.repo) {
        const [owner, name] = r.repo.split('/');
        const feedUrl = `https://github.com/${r.repo}/releases.atom`;
        const src =
          listSources().find((s) => s.url === feedUrl) ??
          upsertSource({
            kind: 'rss',
            name: `Releases · ${name}`,
            url: feedUrl,
            origin: 'interest',
            topic,
            everyMinutes: 360,
          });
        const repoId = (await getJson(`https://api.github.com/repos/${owner}/${name}`, gh)).id;
        const items: RawItem[] = [];
        for (let page = 1; page <= 8; page++) {
          const list = (await getJson(
            `https://api.github.com/repos/${owner}/${name}/releases?per_page=100&page=${page}`,
            gh,
          )) as any[];
          for (const rel of list) {
            const at = Date.parse(rel.published_at ?? rel.created_at);
            if (rel.draft || rel.prerelease || at < sinceMs || !isMilestoneTag(rel.tag_name ?? ''))
              continue;
            items.push({
              sourceId: src.id,
              // Same guid shape as the Atom feed, so daily ingestion and backfill never duplicate.
              externalId: `tag:github.com,2008:Repository/${repoId}/${rel.tag_name}`,
              url: rel.html_url,
              title: `${name} ${rel.name || rel.tag_name}`,
              author: rel.author?.login ?? null,
              publishedAt: new Date(at).toISOString(),
              excerpt: stripMd(rel.body ?? ''),
              backfill: true,
            });
          }
          if (list.length < 100 || Date.parse(list.at(-1)?.published_at ?? '') < sinceMs) break;
        }
        r.releases = insertRawContent(items).inserted;
      }
    });

    const q = encodeURIComponent(topicQuery(topic));
    await attempt('hn', async () => {
      const since = Math.floor(sinceMs / 1000);
      const body = await getJson(
        `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&numericFilters=created_at_i%3E${since},points%3E%3D150&hitsPerPage=25`,
      );
      r.discussions = insertRawContent(
        (body.hits ?? []).map((h: any) => ({
          sourceId: hn.id,
          externalId: String(h.objectID),
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          title: h.title ?? '(untitled)',
          author: h.author ?? null,
          publishedAt: h.created_at ?? null,
          excerpt: `[catch-up: ${topic}] ${h.points ?? 0} points · ${h.num_comments ?? 0} comments · https://news.ycombinator.com/item?id=${h.objectID}`,
          backfill: true,
        })),
      ).inserted;
    });

    // DEV: most-read articles of the period for the tag (tutorials, overviews, opinions)
    await attempt('dev', async () => {
      const list = (await getJson(
        `https://dev.to/api/articles?tag=${slug(topic)}&top=${days}&per_page=15`,
      )) as any[];
      r.articles = insertRawContent(
        list
          .filter((a) => a.positive_reactions_count >= 20)
          .map((a) => ({
            sourceId: devto.id,
            externalId: String(a.id),
            url: a.url,
            title: a.title,
            author: a.user?.name ?? null,
            publishedAt: a.published_at,
            excerpt: `[catch-up: ${topic}] ${a.positive_reactions_count} reações · ${a.reading_time_minutes} min · ${a.description ?? ''}`,
            backfill: true,
          })),
      ).inserted;
    });

    // arXiv: most relevant papers of the period, only for AI/ML topics
    if (AI_WORDS.test(topic))
      await attempt('arxiv', async () => {
        const from = sinceDay.replaceAll('-', '');
        const res = await fetch(
          `http://export.arxiv.org/api/query?search_query=all:%22${q}%22+AND+submittedDate:[${from}0000+TO+${new Date().toISOString().slice(0, 10).replaceAll('-', '')}2359]&sortBy=relevance&max_results=10`,
          { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) },
        );
        const xml = await res.text();
        const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
        const tag = (e: string, t: string) =>
          e
            .match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1]
            ?.replace(/\s+/g, ' ')
            .trim() ?? null;
        r.papers = insertRawContent(
          entries
            .map((e) => ({
              sourceId: arxiv.id,
              externalId: tag(e, 'id') ?? '',
              url: tag(e, 'id') ?? '',
              title: tag(e, 'title') ?? '(paper)',
              author: tag(e, 'name'),
              publishedAt: tag(e, 'published'),
              excerpt: `[catch-up: ${topic}] ${(tag(e, 'summary') ?? '').slice(0, 1200)}`,
              backfill: true,
            }))
            .filter((x) => x.url),
        ).inserted;
      });

    // Stack Overflow: most-voted questions of the period — what people struggled with
    await attempt('stackoverflow', async () => {
      const body = await getJson(
        `https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&tagged=${encodeURIComponent(soTag(topic))}&site=stackoverflow&pagesize=8&fromdate=${Math.floor(sinceMs / 1000)}`,
      );
      r.questions = insertRawContent(
        (body.items ?? [])
          .filter((x: any) => x.score >= 5)
          .map((x: any) => ({
            sourceId: so.id,
            externalId: String(x.question_id),
            url: x.link,
            title: x.title
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&'),
            author: x.owner?.display_name ?? null,
            publishedAt: new Date(x.creation_date * 1000).toISOString(),
            excerpt: `[catch-up: ${topic}] ${x.score} votos · ${x.answer_count} respostas · tags: ${(x.tags ?? []).join(', ')}`,
            backfill: true,
          })),
      ).inserted;
    });

    // GitHub: projects created in the period that gained the most stars
    await attempt('projects', async () => {
      const body = await getJson(
        `https://api.github.com/search/repositories?q=${q}+created:%3E${sinceDay}+stars:%3E%3D300&sort=stars&order=desc&per_page=10`,
        gh,
      );
      r.projects = insertRawContent(
        (body.items ?? []).map((x: any) => ({
          sourceId: ghs.id,
          externalId: String(x.id),
          url: x.html_url,
          title: `${x.full_name}${x.description ? ` — ${x.description}` : ''}`.slice(0, 300),
          author: x.owner?.login ?? null,
          publishedAt: x.created_at,
          excerpt: `[catch-up: ${topic}] ★ ${x.stargazers_count} · ${x.language ?? '?'} · topics: ${(x.topics ?? []).join(', ')}`,
          backfill: true,
        })),
      ).inserted;
    });

    reports.push(r);
  }
  return reports;
}
