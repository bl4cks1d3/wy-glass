import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GUIDE as BUILDER_GUIDE } from "./guide.js";
import { createAutomationTools } from "./automations.js";
import { AUTOMATIONS_GUIDE } from "./automations-guide.js";

const GUIDE = `${BUILDER_GUIDE}\n${AUTOMATIONS_GUIDE}`;

// stdout e o protocolo MCP: qualquer log vai para stderr.
const log = (...args: unknown[]) => console.error("[planner-mcp]", ...args);

const CORE = (process.env.PLANNER_CORE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const AGENT = (process.env.PLANNER_AGENT_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MAX_OUTPUT = 60_000;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type Args = Record<string, unknown>;

async function http(base: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    // resposta nao-JSON: usa o texto
  }
  if (!res.ok) {
    const message = (parsed as { message?: string | string[] } | null)?.message;
    throw new Error(Array.isArray(message) ? message.join("; ") : message ?? `HTTP ${res.status}: ${raw.slice(0, 300)}`);
  }
  return parsed;
}

const core = (method: string, path: string, body?: unknown) => http(CORE, method, path, body);
const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Ferramentas proprias deste servidor: o "banco de dados sob medida" e o guia.
// (Blocos, paineis e todo o resto vem do Agent, ver proxiedTools abaixo.)
// ---------------------------------------------------------------------------

const FIELD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "a-z, 0-9 e _; comeca com letra" },
    label: { type: "string" },
    type: { type: "string", enum: ["text", "longtext", "number", "date", "boolean", "select"] },
    required: { type: "boolean" },
    options: { type: "array", items: { type: "string" }, description: "obrigatorio se type = select" },
  },
  required: ["name", "type"],
};

const EXTRAS: Array<ToolDef & { run: (args: Args) => Promise<unknown> }> = [
  {
    name: "planner_guide",
    description: "Guia completo para construir no Planner Life (colecoes, blocos, design system, modais, paineis). Leia antes de construir.",
    inputSchema: { type: "object", properties: {} },
    run: async () => GUIDE,
  },
  {
    name: "list_collections",
    description: "Lista as colecoes do banco sob medida, com campos e numero de registros.",
    inputSchema: { type: "object", properties: {} },
    run: () => core("GET", "/data/collections"),
  },
  {
    name: "save_collection",
    description: "Cria a colecao (tabela) ou atualiza seu esquema se ja existir. Adicionar campos nao apaga dados.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "identificador: minusculas, numeros e _ (2-40)" },
        label: { type: "string" },
        description: { type: "string" },
        fields: { type: "array", items: FIELD_SCHEMA },
      },
      required: ["name"],
    },
    run: async (a) => {
      const name = String(a.name);
      const exists = await core("GET", `/data/collections/${enc(name)}`).then(() => true, () => false);
      const { name: _n, ...rest } = a;
      return exists ? core("PATCH", `/data/collections/${enc(name)}`, rest) : core("POST", "/data/collections", a);
    },
  },
  {
    name: "delete_collection",
    description: "Exclui uma colecao E todos os seus registros.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    run: (a) => core("DELETE", `/data/collections/${enc(String(a.name))}`),
  },
  {
    name: "list_records",
    description: "Lista registros de uma colecao. Filtros: q (busca), sort, order (asc|desc), limit, offset e 'where' (igualdade por campo).",
    inputSchema: {
      type: "object",
      properties: {
        collection: { type: "string" },
        q: { type: "string" },
        sort: { type: "string" },
        order: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "number" },
        offset: { type: "number" },
        where: { type: "object", description: "{campo: valor}" },
      },
      required: ["collection"],
    },
    run: (a) => {
      const qs = new URLSearchParams();
      for (const k of ["q", "sort", "order", "limit", "offset"]) if (a[k] !== undefined) qs.set(k, String(a[k]));
      for (const [k, v] of Object.entries((a.where ?? {}) as Args)) qs.set(k, String(v));
      return core("GET", `/data/collections/${enc(String(a.collection))}/records${qs.toString() ? `?${qs}` : ""}`);
    },
  },
  {
    name: "save_record",
    description: "Cria (sem recordId) ou atualiza (com recordId, mescla os campos; null limpa) um registro.",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string" }, recordId: { type: "string" }, data: { type: "object", description: "{campo: valor}" } },
      required: ["collection", "data"],
    },
    run: (a) => {
      const base = `/data/collections/${enc(String(a.collection))}/records`;
      return a.recordId ? core("PATCH", `${base}/${enc(String(a.recordId))}`, a.data) : core("POST", base, a.data);
    },
  },
  {
    name: "import_records",
    description: "Cria varios registros de uma vez (ate 500). Devolve quantos entraram e os erros por linha.",
    inputSchema: {
      type: "object",
      properties: { collection: { type: "string" }, records: { type: "array", items: { type: "object" } } },
      required: ["collection", "records"],
    },
    run: async (a) => {
      const rows = Array.isArray(a.records) ? (a.records as Args[]).slice(0, 500) : [];
      const base = `/data/collections/${enc(String(a.collection))}/records`;
      let created = 0;
      const errors: string[] = [];
      for (const [i, row] of rows.entries()) {
        try {
          await core("POST", base, row);
          created++;
        } catch (err) {
          errors.push(`linha ${i + 1}: ${err instanceof Error ? err.message : err}`);
        }
      }
      return { created, failed: errors.length, errors: errors.slice(0, 20) };
    },
  },
  {
    name: "delete_record",
    description: "Exclui um registro.",
    inputSchema: { type: "object", properties: { collection: { type: "string" }, recordId: { type: "string" } }, required: ["collection", "recordId"] },
    run: (a) => core("DELETE", `/data/collections/${enc(String(a.collection))}/records/${enc(String(a.recordId))}`),
  },
  ...createAutomationTools(http, CORE),
];

const extraByName = new Map(EXTRAS.map((t) => [t.name, t]));

/** Tudo o que o agente do Planner sabe fazer (tarefas, agenda, estudos, blocos, paineis, notas...) vira ferramenta MCP. */
async function proxiedTools(): Promise<ToolDef[]> {
  try {
    const list = (await http(AGENT, "GET", "/tools")) as Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
    return list
      .filter((t) => !extraByName.has(t.name))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? { type: "object", properties: {} } }));
  } catch (err) {
    log(`Agent indisponivel em ${AGENT} (${err instanceof Error ? err.message : err}); expondo so as ferramentas de banco.`);
    return [];
  }
}

function asText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… (cortado em ${MAX_OUTPUT} caracteres)` : text;
}

// ---------------------------------------------------------------------------

const server = new Server(
  { name: "planner-life", version: "0.1.0" },
  {
    capabilities: { tools: {}, prompts: {}, resources: {} },
    instructions:
      "Planner Life: o usuario descreve a situacao e voce constroi banco de dados (colecoes), blocos e paineis. Chame planner_guide (ou use o prompt construir-sistema) antes de construir.",
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const proxied = await proxiedTools();
  return {
    tools: [
      ...EXTRAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      ...proxied,
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {}) as Args;
  try {
    const extra = extraByName.get(name);
    if (extra) return { content: [{ type: "text", text: asText(await extra.run(args)) }] };
    const out = (await http(AGENT, "POST", "/tools/call", { name, args })) as { result?: unknown };
    return { content: [{ type: "text", text: asText(out?.result ?? null) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "construir-sistema",
      description: "Explique sua situacao e o Claude monta banco de dados, blocos e painel em canvas no Planner Life.",
      arguments: [{ name: "situacao", description: "Descreva o que voce faz e o que precisa controlar", required: true }],
    },
    {
      name: "construir-automacao",
      description: "Descreva em linguagem natural o que deve acontecer (ex.: 'toda manha as 8h me avise das tarefas') e o Claude desenha a automacao no canvas como rascunho para voce ligar.",
      arguments: [{ name: "pedido", description: "O que a automacao deve fazer e quando", required: true }],
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === "construir-automacao") {
    const pedido = String(request.params.arguments?.pedido ?? "").trim();
    return {
      description: "Construir uma automacao no canvas a partir de um pedido em linguagem natural",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `${AUTOMATIONS_GUIDE}\n\n---\n## Meu pedido\n${pedido || "(o usuario ainda vai descrever)"}\n\n` +
              `Construa agora: consulte automation_nodes e list_automations, monte o fluxo com save_automation (fica como rascunho), simule com run_automation, corrija o que falhar e explique em poucas linhas o que ele faz. ` +
              `Diga que eu preciso abrir a automacao no canvas, revisar e clicar em Ativar.`,
          },
        },
      ],
    };
  }
  if (request.params.name !== "construir-sistema") throw new Error(`prompt desconhecido: ${request.params.name}`);
  const situacao = String(request.params.arguments?.situacao ?? "").trim();
  return {
    description: "Construir um sistema completo no Planner Life a partir da sua situacao",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `${GUIDE}\n\n---\n## Minha situacao\n${situacao || "(o usuario ainda vai descrever)"}\n\n` +
            `Construa agora: modele as colecoes, crie os blocos e monte o painel em canvas, seguindo o fluxo acima. ` +
            `No fim, resuma o que criou (colecoes, blocos, painel) e o que eu preciso aprovar no Construtor.`,
        },
      },
    ],
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "planner://guia-construtor", name: "Guia do construtor", description: "Colecoes, blocos, design system, modais e paineis", mimeType: "text/markdown" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== "planner://guia-construtor") throw new Error(`recurso desconhecido: ${request.params.uri}`);
  return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: GUIDE }] };
});

await server.connect(new StdioServerTransport());
log(`pronto (core ${CORE}, agent ${AGENT})`);
