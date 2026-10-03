// Ferramentas de AUTOMACAO (grafo estilo n8n no canvas do Planner): o Claude monta,
// simula e depura; quem LIGA e o usuario, na tela. Tudo que o Claude salva nasce
// desativado (rascunho); o MCP nao tem ferramenta para ativar nem para executar de verdade.

type Args = Record<string, unknown>;
type Http = (base: string, method: string, path: string, body?: unknown) => Promise<unknown>;
export interface AutomationTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Args) => Promise<unknown>;
}

interface AutomationLike {
  id: string;
  name: string;
  active: boolean;
  nodes: Array<{ id: string; type: string; name: string; config: Record<string, unknown> }>;
  edges: unknown[];
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  source?: string;
  problems?: string[];
}

interface RunLike {
  id: string;
  status: string;
  mode: string;
  triggerType: string;
  error?: string;
  startedAt: string;
  nodes: Array<{ nodeId: string; name: string; type: string; status: string; itemsIn: number; itemsOut: Record<string, number>; output?: Record<string, unknown[]>; error?: string; warnings?: string[] }>;
}

const enc = encodeURIComponent;

const summarize = (a: AutomationLike) => ({
  id: a.id,
  name: a.name,
  state: a.active ? "ativa" : "rascunho (desativada)",
  origem: a.source,
  gatilhos: a.nodes.filter((n) => n.type.startsWith("trigger.")).map((n) => `${n.type}${n.config.cron ? ` (${n.config.cron})` : n.config.event ? ` (${n.config.event})` : n.config.at ? ` (${n.config.at})` : ""}`),
  nos: a.nodes.length,
  fios: a.edges.length,
  ...(a.nextRunAt ? { proximoDisparo: a.nextRunAt } : {}),
  ...(a.lastRunAt ? { ultimaExecucao: `${a.lastRunAt} (${a.lastStatus})` } : {}),
});

const summarizeRun = (run: RunLike, withOutput: boolean) => ({
  id: run.id,
  status: run.status,
  modo: run.mode === "dry" ? "simulacao" : "real",
  gatilho: run.triggerType,
  inicio: run.startedAt,
  ...(run.error ? { erro: run.error } : {}),
  nos: run.nodes.map((n) => ({
    no: `${n.name} (${n.nodeId})`,
    status: n.status,
    entrou: n.itemsIn,
    saiu: n.itemsOut,
    ...(n.error ? { erro: n.error } : {}),
    ...(n.warnings?.length ? { avisos: n.warnings } : {}),
    ...(withOutput && n.output ? { amostra: Object.fromEntries(Object.entries(n.output).map(([p, items]) => [p, items.slice(0, 2)])) } : {}),
  })),
});

export function createAutomationTools(core: Http, coreBase: string): AutomationTool[] {
  const c = (method: string, path: string, body?: unknown) => core(coreBase, method, path, body);

  return [
    {
      name: "automation_nodes",
      description: "Tipos de no das automacoes (campos, portas e exemplo de cada um), eventos que servem de gatilho, ferramentas (nome e parametros) e colecoes disponiveis. Consulte antes de montar.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const cat = (await c("GET", "/automations/catalog")) as {
          nodes: Array<{ type: string; category: string; description: string; inputs: number; outputs: string[]; fields: Array<{ key: string; kind: string; required?: boolean; help?: string }>; example: unknown }>;
          events: Array<{ type: string; payload: string[] }>;
          tools?: Array<{ name: string; params: string[]; required: string[] }>;
          collections: unknown[];
        };
        return {
          nos: cat.nodes.map((n) => ({
            tipo: n.type,
            descricao: n.description,
            entrada: n.inputs === 1,
            saidas: n.outputs,
            campos: n.fields.map((f) => `${f.key}${f.required ? "*" : ""}:${f.kind}`),
            exemplo: n.example,
          })),
          eventos: cat.events.map((e) => `${e.type} {${e.payload.join(", ")}}`),
          ferramentas: cat.tools?.map((t) => `${t.name}(${t.params.map((p) => (t.required.includes(p) ? `${p}*` : p)).join(", ")})`) ?? "Agent fora do ar: nao consegui listar",
          colecoes: cat.collections,
        };
      },
    },
    {
      name: "list_automations",
      description: "Lista as automacoes: estado (ativa/rascunho), gatilhos, proximo disparo e ultimo resultado.",
      inputSchema: { type: "object", properties: {} },
      run: async () => ((await c("GET", "/automations")) as AutomationLike[]).map(summarize),
    },
    {
      name: "get_automation",
      description: "Le uma automacao completa (nos, configuracao e fios) para editar. Envie tudo de volta com save_automation.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: (a) => c("GET", `/automations/${enc(String(a.id))}`),
    },
    {
      name: "save_automation",
      description:
        "Cria (sem id) ou substitui (com id) uma automacao desenhada no canvas do usuario. SEMPRE fica desativada (rascunho): o usuario revisa e liga. Editar uma ativa a desativa. " +
        "nodes: [{id (a-z0-9_), type, name, config}], edges: [{from, fromPort ('main'; 'true'/'false' no Se), to}]. x/y sao opcionais (posicionamos). Erros de validacao voltam para voce corrigir.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "id da automacao (de list_automations) para substituir; omita para criar" },
          name: { type: "string" },
          description: { type: "string" },
          nodes: { type: "array", items: { type: "object" } },
          edges: { type: "array", items: { type: "object" } },
        },
        required: ["name", "nodes"],
      },
      run: async (a) => {
        const body = { name: a.name, description: a.description, nodes: a.nodes, edges: a.edges ?? [], source: "agent" };
        const before = a.id ? ((await c("GET", `/automations/${enc(String(a.id))}`)) as AutomationLike) : undefined;
        const saved = (a.id ? await c("PUT", `/automations/${enc(String(a.id))}`, body) : await c("POST", "/automations", body)) as AutomationLike;
        return {
          ...summarize(saved),
          ...(before?.active ? { aviso: "a automacao estava ativa e foi desativada ate o usuario revisar de novo" } : {}),
          proximoPasso: "Simule com run_automation para conferir os dados; depois peca ao usuario para abrir a automacao no canvas, revisar e ligar (Ativar).",
        };
      },
    },
    {
      name: "run_automation",
      description:
        "SIMULA a automacao (nao muda nada: ferramentas de escrita, avisos e registros sao apenas simulados; leituras rodam de verdade) e devolve, por no, o que entrou/saiu. Use para testar e corrigir. payload = dados do gatilho.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          triggerNodeId: { type: "string", description: "no gatilho a usar (padrao: o manual, ou o primeiro)" },
          payload: { type: "object", description: "dados de exemplo do gatilho, ex.: {title: 'compra urgente'}" },
        },
        required: ["id"],
      },
      run: async (a) => summarizeRun((await c("POST", `/automations/${enc(String(a.id))}/run`, { mode: "dry", triggerNodeId: a.triggerNodeId, payload: a.payload })) as RunLike, true),
    },
    {
      name: "automation_runs",
      description: "Ultimas execucoes de uma automacao (real e simulacao) com o resultado por no: para descobrir por que algo falhou.",
      inputSchema: { type: "object", properties: { id: { type: "string" }, limit: { type: "number" } }, required: ["id"] },
      run: async (a) => ((await c("GET", `/automations/${enc(String(a.id))}/runs?limit=${Math.min(10, Number(a.limit) || 5)}`)) as RunLike[]).map((r) => summarizeRun(r, false)),
    },
    {
      name: "delete_automation",
      description: "Exclui uma automacao e seu historico.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: (a) => c("DELETE", `/automations/${enc(String(a.id))}`),
    },
  ];
}
