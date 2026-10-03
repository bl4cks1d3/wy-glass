// Starter data. `init` = real sources only. `demo` = the example world from
// docs/design/My Current Brain.dc.html so every screen has something to show.
import {
  addBuildWatch,
  insertRawContent,
  listPendingContent,
  saveBrief,
  saveContentAnalysis,
  saveProfile,
  upsertKnowledge,
  upsertLearning,
  upsertLearningPath,
  upsertProject,
  upsertSource,
} from './repo';
import type { Category, ContentAnalysis, KnowledgeStatus, Source } from './types';

export const DEFAULT_SOURCES: (Pick<Source, 'kind' | 'name' | 'url'> & Partial<Source>)[] = [
  {
    kind: 'hn',
    name: 'Hacker News',
    url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30',
    defaultArea: 'now',
    everyMinutes: 30,
  },
  {
    kind: 'rss',
    name: 'arXiv cs.AI',
    url: 'https://rss.arxiv.org/rss/cs.AI',
    defaultArea: 'frontier',
    everyMinutes: 60,
  },
  {
    kind: 'rss',
    name: 'Simon Willison',
    url: 'https://simonwillison.net/atom/everything/',
    defaultArea: 'now',
    everyMinutes: 60,
  },
  {
    kind: 'rss',
    name: 'GitHub Blog',
    url: 'https://github.blog/feed/',
    defaultArea: 'now',
    everyMinutes: 60,
  },
  {
    kind: 'rss',
    name: 'Hugging Face Blog',
    url: 'https://huggingface.co/blog/feed.xml',
    defaultArea: 'learn',
    everyMinutes: 60,
  },
  {
    kind: 'rss',
    name: 'Releases · ollama',
    url: 'https://github.com/ollama/ollama/releases.atom',
    defaultArea: 'now',
    everyMinutes: 15,
  },
  {
    kind: 'rss',
    name: 'Releases · pgvector',
    url: 'https://github.com/pgvector/pgvector/releases.atom',
    defaultArea: 'now',
    everyMinutes: 15,
  },
  {
    kind: 'rss',
    name: 'Releases · MCP spec',
    url: 'https://github.com/modelcontextprotocol/modelcontextprotocol/releases.atom',
    defaultArea: 'now',
    everyMinutes: 15,
  },
];

export function seedInit() {
  for (const s of DEFAULT_SOURCES) upsertSource({ ...s, origin: 'default' });
}

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

type DemoItem = {
  id: string;
  hoursAgo: number;
  category: Category;
  area: ContentAnalysis['area'];
  title: string;
  excerpt: string;
} & Omit<ContentAnalysis, 'area' | 'category'>;

const DEMO_ITEMS: DemoItem[] = [
  {
    id: 'tessellate',
    hoursAgo: 1,
    category: 'TOOL',
    area: 'now',
    priority: 'P1',
    readMinutes: 8,
    title: 'Tessellate 0.4: framework open-source para agentes locais',
    excerpt: 'Tessellate 0.4 released with typed tool calling and persistent SQLite memory.',
    summary:
      'Framework em Python para orquestrar agentes que rodam inteiramente na máquina local, com tool calling tipado e memória persistente em SQLite.',
    whyItMatters:
      'Você está estudando AI Agents, e o seu AI Research Assistant ainda não tem uma camada de ferramentas.',
    tags: ['AI', 'AGENTS', 'PYTHON', 'OPEN SOURCE'],
    learnTopic: 'Tool Calling',
    relatedKnowledge: ['Agents', 'Tool Calling', 'Memory'],
    keyPoints: [
      'Ferramentas são funções Python com tipos; o esquema JSON é gerado automaticamente.',
      'Funciona com qualquer modelo local que exponha a API de chat padrão.',
      'A memória de longo prazo fica em um arquivo SQLite, sem servidor extra.',
    ],
    explain: {
      code: 'from tessellate import Agent, tool\n\n@tool\ndef search_papers(query: str, limit: int = 5) -> list[dict]:\n    """Busca papers no índice local."""\n    return index.search(query, k=limit)\n\nagent = Agent(model="local/default", tools=[search_papers])\nagent.run("O que saiu sobre memória de agentes?")',
      architecture:
        'User ─▶ Agent ─▶ LLM (local)\n            │\n            ├─▶ Tool registry ─▶ search_papers()\n            │\n            └─▶ Memory (SQLite)',
      application:
        'Substitua a busca manual do seu AI Research Assistant por uma ferramenta registrada. O agente decide quando consultar o índice e cita a origem de cada trecho.',
    },
  },
  {
    id: 'kiln',
    hoursAgo: 2,
    category: 'RELEASE',
    area: 'now',
    priority: 'P2',
    readMinutes: 5,
    title: 'Kiln 1.2 adiciona batching contínuo para inferência local',
    excerpt: 'Kiln 1.2: continuous batching, up to 2.3x throughput on consumer GPUs.',
    summary:
      'O runtime de inferência passa a processar várias requisições em paralelo, com ganho de até 2,3× em throughput em GPUs de consumo.',
    whyItMatters:
      'Relevante para o seu projeto de IA local: menor latência quando o assistente atende várias consultas ao mesmo tempo.',
    tags: ['AI', 'LOCAL', 'LLM'],
    learnTopic: 'LLM',
    relatedKnowledge: ['LLM', 'AI'],
    keyPoints: [
      'Batching contínuo agrupa requisições por token, não por lote fixo.',
      'A atualização é compatível com os modelos já baixados.',
      'O ganho é maior com contextos curtos e muitas requisições simultâneas.',
    ],
    explain: {
      code: 'kiln serve ./models/default \\\n  --batching continuous \\\n  --max-concurrent 8',
      architecture: 'Req A ─┐\nReq B ─┼─▶ Scheduler ─▶ GPU (batch dinâmico)\nReq C ─┘',
      application:
        'Rode o benchmark do seu assistente antes e depois da atualização para medir a latência p95.',
    },
  },
  {
    id: 'cve',
    hoursAgo: 3,
    category: 'SECURITY',
    area: 'now',
    priority: 'P0',
    readMinutes: 3,
    title: 'CVE-2026-4417: execução remota em parser YAML popular do Node.js',
    excerpt:
      'Versions before 5.3.2 allow code execution when loading untrusted YAML with custom types.',
    summary:
      'Versões anteriores à 5.3.2 permitem execução de código ao carregar YAML não confiável com tipos customizados ativados.',
    whyItMatters: 'Sua API assíncrona com Node.js usa essa biblioteca como dependência transitiva.',
    tags: ['SECURITY', 'NODE.JS'],
    learnTopic: 'Supply chain',
    relatedKnowledge: ['Python'],
    keyPoints: [
      'A falha só ocorre com a opção de tipos customizados ativa.',
      'A versão 5.3.2 corrige o problema sem mudanças de API.',
      'Rode npm ls para localizar a dependência transitiva.',
    ],
    explain: {
      code: 'npm ls yaml-parse\nnpm install yaml-parse@^5.3.2',
      architecture: 'sua-api ─▶ config-loader ─▶ yaml-parse@5.1.0  (vulnerável)',
      application:
        'Atualize a dependência e adicione um teste que carrega um YAML malicioso conhecido.',
    },
  },
  {
    id: 'episodic',
    hoursAgo: 20,
    category: 'RESEARCH',
    area: 'now',
    priority: 'P2',
    readMinutes: 14,
    title: 'Memória episódica reduz erros de agentes em tarefas longas',
    excerpt: 'Paper separating working and episodic memory; 31% fewer errors on 50+ step tasks.',
    summary:
      'O paper separa memória de trabalho e memória episódica, com recuperação por relevância temporal. Os agentes testados erram 31% menos em tarefas com mais de 50 passos.',
    whyItMatters: 'Memory é uma das lacunas detectadas na sua trilha de AI Agents.',
    tags: ['RESEARCH', 'AGENTS', 'MEMORY'],
    learnTopic: 'Memory',
    relatedKnowledge: ['Memory', 'Agents'],
    keyPoints: [
      'Memória de trabalho guarda só os últimos passos; o resto vai para a episódica.',
      'A recuperação pondera relevância semântica e distância no tempo.',
      'O código dos experimentos foi publicado junto com o paper.',
    ],
    explain: {
      code: '# pseudocódigo do paper\nctx = working_memory[-8:]\nctx += episodic.retrieve(query, decay=0.92, k=4)\nresponse = llm(ctx + [query])',
      architecture:
        'Passo n ─▶ Working memory (8)\n              │ overflow\n              ▼\n         Episodic store ─▶ retrieve(query, tempo)',
      application: 'Leia depois de concluir Tool Calling. Salvo na sua fila de Memory.',
    },
  },
  {
    id: 'lattice',
    hoursAgo: 22,
    category: 'RELEASE',
    area: 'now',
    priority: 'P2',
    readMinutes: 6,
    title: 'Lattice DB 3.0 traz busca híbrida nativa',
    excerpt: 'Lattice DB 3.0: BM25 + vector hybrid search in one query, optional reranking.',
    summary:
      'O banco vetorial open-source combina BM25 e busca por embeddings em uma única consulta, com reranking opcional.',
    whyItMatters: 'Você vai implementar retrieval no AI Research Assistant nesta semana.',
    tags: ['DATABASE', 'RAG', 'EMBEDDINGS'],
    learnTopic: 'Retrieval',
    relatedKnowledge: ['RAG', 'Embeddings', 'Retrieval'],
    keyPoints: [
      'Uma consulta retorna resultados léxicos e semânticos já fundidos.',
      'O reranking usa um cross-encoder opcional.',
      'Há um guia de migração a partir do pgvector.',
    ],
    explain: {
      code: 'results = db.search(\n    text="memória de agentes",\n    vector=embed("memória de agentes"),\n    hybrid_alpha=0.6,\n    rerank=True,\n)',
      architecture:
        'Query ─┬─▶ BM25 ───────┐\n        └─▶ Embeddings ──┼─▶ Fusion ─▶ Rerank ─▶ Top k',
      application:
        'Compare busca híbrida com a busca vetorial pura do seu projeto antes de decidir migrar.',
    },
  },
  {
    id: 'tracegrid',
    hoursAgo: 23,
    category: 'TOOL',
    area: 'now',
    priority: 'P3',
    readMinutes: 4,
    title: 'tracegrid: observabilidade open-source para chamadas de LLM',
    excerpt: 'tracegrid logs prompts, latency, tokens and cost per call; exports to OpenTelemetry.',
    summary:
      'Registra prompts, latência, tokens e custo por chamada, com painel local e exportação para OpenTelemetry.',
    whyItMatters: 'Observability é o último módulo da sua trilha de AI Agents.',
    tags: ['AI', 'OBSERVABILITY', 'OPEN SOURCE'],
    learnTopic: 'Observability',
    relatedKnowledge: ['Evaluation', 'Agents'],
    keyPoints: [
      'Instrumentação com um decorator por função.',
      'Painel roda localmente na porta 4319.',
      'Exporta traces para qualquer coletor OpenTelemetry.',
    ],
    explain: {
      code: 'import tracegrid\n\n@tracegrid.trace(name="answer")\ndef answer(q):\n    return llm.generate(q)',
      architecture: 'App ─▶ tracegrid SDK ─▶ painel local\n                   └─▶ OTel collector',
      application: 'Adicione no AI Research Assistant quando chegar na etapa de avaliação.',
    },
  },
  ...(
    [
      [
        'f1',
        'RESEARCH',
        'Modelos com estado persistente entre sessões',
        'Três grupos publicaram abordagens distintas em setembro. Nenhuma tem implementação estável.',
        '3 papers · 2 repositórios',
        1,
      ],
      [
        'f2',
        'EXPERIMENTAL',
        'Compiladores que otimizam prompts como programas',
        'Tratam cadeias de prompts como grafos e otimizam custo e acerto automaticamente.',
        '1 paper · 4 repositórios · 2,1k stars',
        2,
      ],
      [
        'f3',
        'OPEN_SOURCE',
        'Protocolo aberto para agentes negociarem ferramentas',
        'Especificação em rascunho para que agentes de fornecedores diferentes descubram e usem ferramentas uns dos outros.',
        'Rascunho v0.2 · 11 implementações',
        2,
      ],
      [
        'f4',
        'EMERGING',
        'Inferência local em NPUs de notebooks',
        'Runtimes começam a suportar as NPUs dos chips de 2026. Ganho de bateria relevante, desempenho ainda irregular.',
        '3 runtimes · benchmarks divergentes',
        3,
      ],
      [
        'f5',
        'EARLY_STAGE',
        'Índice vetorial embutido no WAL do banco',
        'Proposta de indexar embeddings durante a escrita, eliminando o reindex periódico.',
        '1 protótipo · discussão na lista do projeto',
        1,
      ],
    ] as const
  ).map(([id, category, title, note, signals, maturity], i) => ({
    id,
    hoursAgo: 4 + i,
    category,
    area: 'frontier' as const,
    priority: 'P3' as const,
    readMinutes: 4,
    title,
    excerpt: note,
    summary: note,
    whyItMatters: 'Sinal emergente. Você não precisa aprender agora.',
    tags: ['FRONTIER'],
    keyPoints: [],
    signals,
    maturity,
  })),
];

const K = (
  name: string,
  fullName: string,
  domain: string,
  status: KnowledgeStatus,
  confidence: number,
  x: number,
  y: number,
  related: string[],
  evidence: string[],
  nextStep: string,
  gapReason: string | null = null,
) => ({
  name,
  fullName,
  domain,
  status,
  confidence,
  pos: { x, y },
  related,
  nextStep,
  gapReason,
  evidence: evidence.map((note) => ({ kind: 'seen' as const, note, at: ago(48) })),
});

const DEMO_KNOWLEDGE = [
  K(
    'Python',
    'Linguagem principal',
    'Backend',
    'MASTERED',
    9,
    16,
    14,
    ['LLM'],
    ['4 projetos concluídos', 'Uso diário no GitHub'],
    'Revisar async em Python.',
  ),
  K(
    'AI',
    'Inteligência artificial aplicada',
    'AI',
    'APPLIED',
    7,
    50,
    12,
    ['LLM', 'RAG', 'Agents'],
    ['2 projetos com LLM', '14 conteúdos estudados'],
    'Aprofundar em Agents.',
  ),
  K(
    'LLM',
    'Large Language Models',
    'AI',
    'PRACTICING',
    6,
    25,
    38,
    ['Prompting', 'RAG', 'Python'],
    ['Integrou API em 2 projetos', 'Concluiu LLM Fundamentals'],
    'Estudar limites de contexto.',
  ),
  K(
    'RAG',
    'Retrieval Augmented Generation',
    'AI',
    'PRACTICING',
    6,
    50,
    40,
    ['Embeddings', 'Retrieval', 'Evaluation'],
    ['Implementou chunking e embeddings', 'Estudou 5 artigos'],
    'Evaluation de respostas.',
  ),
  K(
    'Agents',
    'Agentes de IA',
    'AI',
    'LEARNING',
    3,
    76,
    38,
    ['Tool Calling', 'Memory', 'Evaluation'],
    ['Leu 6 conteúdos', 'Trilha em andamento'],
    'Concluir Tool Calling.',
  ),
  K(
    'Prompting',
    'Engenharia de prompts',
    'AI',
    'APPLIED',
    7,
    10,
    64,
    ['LLM'],
    ['Concluiu módulo da trilha', 'Usado em 2 projetos'],
    'Prompts versionados.',
  ),
  K(
    'Embeddings',
    'Representações vetoriais',
    'AI',
    'LEARNING',
    4,
    38,
    64,
    ['RAG', 'Vector DB'],
    ['Gerou embeddings no projeto'],
    'Comparar modelos de embedding.',
  ),
  K(
    'Retrieval',
    'Recuperação de contexto',
    'AI',
    'LEARNING',
    3,
    58,
    64,
    ['RAG'],
    ['Tarefa em andamento'],
    'Implementar busca híbrida.',
  ),
  K(
    'Tool Calling',
    'Chamada de ferramentas por LLMs',
    'AI',
    'LEARNING',
    3,
    78,
    64,
    ['Agents'],
    ['Sessão iniciada'],
    'Sessão de 15 min.',
  ),
  K(
    'Vector DB',
    'Bancos vetoriais',
    'Database',
    'DISCOVERED',
    1,
    28,
    87,
    ['Embeddings'],
    ['Visto em 3 conteúdos'],
    'Ler sobre Lattice DB 3.0.',
  ),
  K(
    'Evaluation',
    'Avaliação de sistemas de IA',
    'AI',
    'DISCOVERED',
    1,
    64,
    87,
    ['RAG', 'Agents'],
    ['Visto em 2 conteúdos'],
    'Introdução a métricas de RAG.',
    'Necessário para concluir o AI Research Assistant.',
  ),
  K(
    'Memory',
    'Memória de agentes',
    'AI',
    'DISCOVERED',
    1,
    88,
    87,
    ['Agents'],
    ['Visto em 3 conteúdos'],
    'Ler o paper de memória episódica.',
    'Aparece em 3 conteúdos desta semana e é pré-requisito de Agent Architecture.',
  ),
  K(
    'Agent Architecture',
    'Arquitetura de agentes',
    'AI',
    'DISCOVERED',
    0,
    92,
    64,
    ['Agents', 'Memory'],
    [],
    'Depois de Tool Calling e Memory.',
    'Próximo passo depois de Tool Calling e Memory.',
  ),
  K(
    'Observability',
    'Observabilidade de LLMs',
    'DevOps',
    'DISCOVERED',
    0,
    46,
    87,
    ['Evaluation'],
    [],
    'Instrumentar chamadas de LLM.',
    'Último módulo da trilha AI Agents.',
  ),
  K(
    'Event Loop',
    'Loop de eventos do Node.js',
    'Backend',
    'LEARNING',
    5,
    6,
    87,
    ['Python'],
    ['Sessão em andamento'],
    'Terminar a sessão.',
  ),
];

const T = (title: string, s: 'D' | 'P' | 'T') => ({
  title,
  status: s === 'D' ? ('DONE' as const) : s === 'P' ? ('IN_PROGRESS' as const) : ('TODO' as const),
});

export function seedDemo() {
  seedInit();
  saveProfile({ onboarded: true });

  const demo = upsertSource({
    kind: 'rss',
    name: 'Exemplo (demo)',
    url: 'demo://my-current-brain',
    origin: 'agent',
    enabled: false,
  });
  insertRawContent(
    DEMO_ITEMS.map((d) => ({
      sourceId: demo.id,
      externalId: d.id,
      url: '#',
      title: d.title,
      excerpt: d.excerpt,
      publishedAt: ago(d.hoursAgo),
    })),
  );
  const byExt = new Map(
    listPendingContent(100)
      .filter((c) => c.sourceId === demo.id)
      .map((c) => [c.externalId, c.id]),
  );
  const ids: Record<string, string> = {};
  for (const { id, hoursAgo, title, excerpt, ...analysis } of DEMO_ITEMS) {
    const cid = byExt.get(id);
    if (!cid) continue;
    ids[id] = cid;
    saveContentAnalysis(cid, analysis);
  }

  for (const k of DEMO_KNOWLEDGE) upsertKnowledge(k);

  upsertProject({
    id: 'research',
    name: 'AI Research Assistant',
    status: 'BUILDING',
    goal: 'Assistente que lê papers, extrai conceitos e responde com citações da fonte.',
    technologies: ['Python', 'FastAPI', 'PostgreSQL', 'pgvector', 'LLM'],
    prerequisites: [
      { name: 'Python', known: true },
      { name: 'APIs', known: true },
      { name: 'Embeddings', known: false },
      { name: 'Retrieval', known: false },
      { name: 'Evaluation', known: false },
    ],
    tasks: [
      T('Upload e parsing de PDFs', 'D'),
      T('Chunking por seção', 'D'),
      T('Gerar embeddings', 'D'),
      T('Armazenar no pgvector', 'D'),
      T('Implementar retrieval', 'P'),
      T('Respostas com citações', 'T'),
      T('Interface de busca', 'T'),
      T('Avaliação de respostas', 'T'),
    ],
  });
  upsertProject({
    id: 'nodeapi',
    name: 'API assíncrona com Node.js',
    status: 'PLANNED',
    goal: 'API que processa jobs em fila e expõe status em tempo real.',
    technologies: ['Node.js', 'TypeScript', 'Redis'],
    prerequisites: [
      { name: 'JavaScript', known: true },
      { name: 'Promises', known: true },
      { name: 'Event Loop', known: false },
    ],
    tasks: [
      T('Estrutura do projeto', 'D'),
      T('Rotas com async/await', 'P'),
      T('Fila de jobs', 'T'),
      T('Testes de carga', 'T'),
    ],
  });
  upsertProject({
    id: 'ws',
    name: 'Chat em tempo real',
    status: 'IDEA',
    goal: 'Chat com presença de usuários usando WebSockets.',
    technologies: ['WebSockets', 'Node.js'],
    prerequisites: [
      { name: 'JavaScript', known: true },
      { name: 'WebSockets', known: false },
    ],
    tasks: [T('Protótipo com WebSockets', 'T'), T('Presença de usuários', 'T')],
  });
  upsertProject({
    id: 'raglocal',
    name: 'Assistente RAG local',
    status: 'IDEA',
    aiSuggested: true,
    difficulty: 'Intermediário',
    estimatedTime: '2h 30m',
    reason: 'Usa o que você viu hoje sobre Kiln e Lattice DB.',
    sourceContentId: ids.lattice ?? null,
    goal: 'Assistente que responde sobre seus documentos sem enviar dados para fora da máquina.',
    technologies: ['Python', 'Kiln', 'Lattice DB'],
    prerequisites: [
      { name: 'Python', known: true },
      { name: 'APIs', known: true },
      { name: 'Embeddings', known: false },
    ],
    tasks: [
      T('Ingestão de documentos', 'T'),
      T('Embeddings locais', 'T'),
      T('Busca híbrida', 'T'),
      T('Interface CLI', 'T'),
    ],
  });

  upsertLearning({
    title: 'Event Loop',
    track: 'JAVASCRIPT',
    progress: 70,
    stepsDone: 3,
    minutesTotal: 50,
    why: 'Pré-requisito da sua API assíncrona com Node.js.',
  });
  upsertLearning({
    title: 'Tool Calling',
    track: 'AI AGENTS',
    progress: 30,
    stepsDone: 0,
    why: 'Pré-requisito para Memory e Agent Architecture. Aparece em 2 conteúdos de hoje.',
    sourceContentId: ids.tessellate ?? null,
  });
  upsertLearning({
    title: 'Embeddings',
    track: 'RAG',
    progress: 45,
    stepsDone: 2,
    minutesTotal: 36,
    why: 'Necessário para o retrieval do AI Research Assistant.',
  });

  upsertLearningPath({
    name: 'AI Agents',
    goal: 'Construir agentes confiáveis',
    modules: [
      { title: 'LLM Fundamentals', status: 'done' },
      { title: 'Prompting', status: 'done' },
      { title: 'Tool Calling', status: 'current' },
      { title: 'Memory', status: 'gap' },
      { title: 'RAG', status: 'todo' },
      { title: 'Agent Architecture', status: 'gap' },
      { title: 'Evaluation', status: 'gap' },
      { title: 'Observability', status: 'gap' },
    ],
  });

  const W = (
    project: string,
    author: string,
    h: number,
    changes: [string, string][],
    why: string,
    technologies: string[],
  ) =>
    addBuildWatch({
      project,
      author,
      url: '#',
      happenedAt: ago(h),
      why,
      technologies,
      changes: changes.map(([sign, text]) => ({ sign: sign as '+' | '-' | '~', text })),
    });
  W(
    'Local AI Assistant',
    '@marina.dev',
    2,
    [
      ['+', 'Adicionou memória episódica'],
      ['+', 'Adicionou RAG sobre notas locais'],
      ['~', 'Migrou inferência para Kiln 1.2'],
    ],
    'Mesmo stack do seu AI Research Assistant.',
    ['Python', 'FastAPI', 'Kiln', 'PostgreSQL'],
  );
  W(
    'pgtrace',
    '@okonkwo',
    5,
    [
      ['+', 'Traces de consultas vetoriais'],
      ['~', 'Refatorou o exportador'],
    ],
    'Útil para depurar o retrieval que você vai implementar.',
    ['Go', 'PostgreSQL'],
  );
  W(
    'rustic-search',
    '@lina-k',
    26,
    [
      ['+', 'Reranking com cross-encoder'],
      ['+', 'Benchmarks publicados'],
    ],
    'Mostra na prática o ganho de reranking que aparece no Lattice DB 3.0.',
    ['Rust', 'Embeddings'],
  );
  W(
    'agent-evals',
    '@t.moreau',
    50,
    [
      ['+', '40 casos de teste para tool calling'],
      ['-', 'Removeu suporte a formato legado'],
    ],
    'Material pronto para o módulo Evaluation da sua trilha.',
    ['Python', 'Agents'],
  );

  saveBrief({
    date: new Date().toISOString().slice(0, 10),
    type: 'daily',
    headline: 'Bom dia.\nIsto mudou enquanto você estava fora.',
    intro: null,
    itemIds: [ids.tessellate, ids.kiln, ids.cve].filter(Boolean),
    blocks: [
      {
        kind: 'learn',
        label: 'LEARN · 20 MIN',
        title: 'Event Loop',
        meta: 'Faltam 15 min para concluir',
      },
      {
        kind: 'build',
        label: 'BUILD · 45 MIN',
        title: 'Implementar retrieval',
        meta: 'AI Research Assistant',
      },
      {
        kind: 'watch',
        label: 'BUILD WATCH · 12 MIN',
        title: 'Local AI Assistant ganhou memória',
        meta: '@marina.dev · há 2 h',
      },
      {
        kind: 'frontier',
        label: 'FRONTIER',
        title: '3 sinais emergentes',
        meta: 'Para saber que existem',
      },
    ],
    nextMove: {
      title: 'Entender Tool Calling em 15 minutos.',
      action: 'Aprender isto',
      href: '/learn',
    },
    stats: { analyzed: 327, relevant: 11, minutes: 18 },
  });
}
