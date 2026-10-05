import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";

// Chamada de voz (modo conversacional): navegador <-> este servico <-> Gemini Live.
// A chave do Gemini fica SO aqui. O Gemini pode chamar as ferramentas do Planner (as
// mesmas do agente: notas, agenda, pesquisa, tarefas...) que executam no Agent, e o
// navegador so recebe o audio, as transcricoes e o nome das ferramentas usadas.

const GEMINI_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const AGENT_URL = (process.env.AGENT_API_URL ?? `http://localhost:${process.env.AGENT_PORT ?? "4100"}`).replace(/\/$/, "");
const MAX_SESSION_MS = 14 * 60_000; // o Gemini corta audio em 15 min
const MAX_TOOL_OUTPUT = 12_000; // caracteres devolvidos ao modelo por chamada
const DEFAULT_ORIGINS = ["http://localhost:4300", "http://127.0.0.1:4300"];
// por voz nao se apaga nada sem confirmacao digitada: ferramentas destrutivas ficam de fora
const DESTRUCTIVE = /^(delete_|clear_|disconnect_)/;
const NEVER = new Set(["run_claude_code", "use_skill"]);

interface AgentTool {
  name: string;
  description?: string;
  inputSchema?: { type?: string; properties?: Record<string, unknown> };
}

let active = 0;

function port(): number {
  return Number(process.env.VOICE_PORT ?? 4200);
}

function originsAllowed(): Set<string> {
  const extra = (process.env.VOICE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

// WebSocket nao passa por CORS: sem checar Origin/Host qualquer site aberto no navegador
// poderia abrir uma chamada (gasta a cota do Gemini e aciona ferramentas do Planner).
export function upgradeAllowed(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  if (addr !== "127.0.0.1" && addr !== "::1" && addr !== "::ffff:127.0.0.1") return false;
  const host = (req.headers.host ?? "").toLowerCase();
  if (![`localhost:${port()}`, `127.0.0.1:${port()}`, `[::1]:${port()}`].includes(host)) return false;
  const origin = req.headers.origin;
  return typeof origin === "string" && originsAllowed().has(origin);
}

export function liveModel(): string {
  return process.env.GEMINI_LIVE_MODEL?.trim() || "gemini-3.8-live";
}

// Gemini aceita um subconjunto de JSON Schema: fica so o que ele entende.
function cleanSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["type", "description", "enum", "format", "required", "nullable"]) if (k in s) out[k] = s[k];
  if (s.properties && typeof s.properties === "object") {
    out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, cleanSchema(v)]));
  }
  if (s.items) out.items = cleanSchema(s.items);
  return out;
}

export async function loadLiveTools(): Promise<{ declarations: unknown[]; allowed: Set<string> }> {
  const res = await fetch(`${AGENT_URL}/tools`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Agent respondeu ${res.status}`);
  const all = (await res.json()) as AgentTool[];
  const allowDestructive = process.env.LIVE_ALLOW_DESTRUCTIVE === "true";
  const tools = all.filter((t) => !NEVER.has(t.name) && (allowDestructive || !DESTRUCTIVE.test(t.name)));
  const declarations = tools.map((t) => {
    const hasParams = t.inputSchema?.properties && Object.keys(t.inputSchema.properties).length > 0;
    return {
      name: t.name,
      description: (t.description ?? "").slice(0, 400),
      ...(hasParams ? { parameters: cleanSchema(t.inputSchema) } : {}),
    };
  });
  return { declarations, allowed: new Set(tools.map((t) => t.name)) };
}

function systemPrompt(): string {
  const now = new Date();
  const when = now.toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    "Voce e o assistente por voz do Planner Life, um planner pessoal. Fale sempre em portugues do Brasil, com frases curtas e naturais, como numa ligacao. " +
    "Use as ferramentas para consultar e agir: pesquisa e notas (search_notes, list_notes, read_note, create_note, create_research_note), agenda (list_calendar_events, create_calendar_event, update_calendar_event), " +
    "tarefas, projetos, estudos, agendamentos e lembretes, e o que mais existir na lista. " +
    "Quando faltar um dado essencial (hora, titulo), pergunte em uma frase; se estiver claro, faca direto e diga o resultado em uma frase. " +
    "Nunca invente dados: se uma ferramenta falhar ou nao achar nada, diga isso. Para apagar algo, peca ao usuario para fazer pelo painel. " +
    `Agora: ${when} (fuso ${zone}).`
  );
}

interface ClientEvent {
  type: string;
  [key: string]: unknown;
}

function handleClient(client: WebSocket): void {
  const send = (event: ClientEvent) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(event));
  };
  const key = process.env.GEMINI_LIVE_API_KEY?.trim();
  if (!key) {
    send({ type: "error", message: "Chamada de voz sem chave: preencha GEMINI_LIVE_API_KEY no .env (ou em Configurações) e reinicie o serviço de voz." });
    client.close();
    return;
  }
  if (active >= 1) {
    send({ type: "error", message: "Já existe uma chamada de voz em andamento." });
    client.close();
    return;
  }
  active += 1;

  let upstream: WebSocket | null = null;
  let allowed = new Set<string>();
  let ready = false;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;

  const shutdown = (reason?: string) => {
    if (closed) return;
    closed = true;
    active -= 1;
    clearTimeout(timer);
    if (reason) send({ type: "closed", reason });
    try {
      upstream?.close();
    } catch {
      // ja fechado
    }
    try {
      client.close();
    } catch {
      // ja fechado
    }
  };

  client.on("close", () => shutdown());
  client.on("error", () => shutdown());

  async function runTool(call: { id?: string; name?: string; args?: Record<string, unknown> }) {
    const name = String(call.name ?? "");
    send({ type: "tool", name, args: call.args ?? {}, status: "running" });
    if (!allowed.has(name)) {
      send({ type: "tool", name, status: "error", message: "ferramenta não permitida por voz" });
      return { id: call.id, name, response: { error: `A ferramenta ${name} não pode ser usada por voz.` } };
    }
    try {
      const res = await fetch(`${AGENT_URL}/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args: call.args ?? {} }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => ({}))) as { result?: unknown; message?: string | string[] };
      if (!res.ok) {
        const message = Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? `Agent respondeu ${res.status}`);
        throw new Error(message);
      }
      let text = typeof body.result === "string" ? body.result : JSON.stringify(body.result ?? null);
      if (text.length > MAX_TOOL_OUTPUT) text = `${text.slice(0, MAX_TOOL_OUTPUT)}… (cortado)`;
      send({ type: "tool", name, status: "ok" });
      return { id: call.id, name, response: { result: text } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: "tool", name, status: "error", message });
      return { id: call.id, name, response: { error: message } };
    }
  }

  async function onGemini(message: Record<string, any>): Promise<void> {
    if (message.setupComplete) {
      ready = true;
      send({ type: "ready", model: liveModel() });
      return;
    }
    const content = message.serverContent;
    if (content) {
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && client.readyState === WebSocket.OPEN) client.send(Buffer.from(part.inlineData.data, "base64"));
      }
      if (content.inputTranscription?.text) send({ type: "input_text", text: content.inputTranscription.text });
      if (content.outputTranscription?.text) send({ type: "output_text", text: content.outputTranscription.text });
      if (content.interrupted) send({ type: "interrupted" });
      if (content.turnComplete) send({ type: "turn_complete" });
    }
    if (message.toolCall?.functionCalls?.length) {
      const responses = await Promise.all((message.toolCall.functionCalls as Array<{ id?: string; name?: string; args?: Record<string, unknown> }>).map(runTool));
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    }
    if (message.goAway) send({ type: "notice", message: "A chamada vai ser encerrada em instantes (limite do serviço)." });
  }

  (async () => {
    let tools: Awaited<ReturnType<typeof loadLiveTools>>;
    try {
      tools = await loadLiveTools();
    } catch (err) {
      send({ type: "error", message: `O Agent não respondeu (${err instanceof Error ? err.message : err}). Suba o pnpm dev e tente de novo.` });
      shutdown();
      return;
    }
    if (closed) return;
    allowed = tools.allowed;

    upstream = new WebSocket(GEMINI_URL, { headers: { "x-goog-api-key": key } });
    upstream.on("open", () => {
      upstream?.send(
        JSON.stringify({
          setup: {
            model: `models/${liveModel()}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_LIVE_VOICE?.trim() || "Kore" } } },
            },
            systemInstruction: { parts: [{ text: systemPrompt() }] },
            tools: [{ functionDeclarations: tools.declarations }],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
        })
      );
    });
    upstream.on("message", (data) => {
      try {
        void onGemini(JSON.parse(data.toString()));
      } catch {
        // mensagem que nao e JSON: ignora
      }
    });
    upstream.on("unexpected-response", (_req, res) => {
      send({ type: "error", message: `O Gemini recusou a conexão (HTTP ${res.statusCode}). Confira a chave e o modelo (${liveModel()}).` });
      shutdown();
    });
    upstream.on("error", (err) => {
      send({ type: "error", message: `Falha na conexão com o Gemini: ${err.message}` });
      shutdown();
    });
    upstream.on("close", (code, reason) => {
      const why = reason?.toString();
      shutdown(code === 1000 ? "Chamada encerrada." : `Conexão com o Gemini encerrada${why ? `: ${why}` : ""}.`);
    });
    timer = setTimeout(() => shutdown("Limite de 15 minutos da chamada."), MAX_SESSION_MS);
  })();

  client.on("message", (data, isBinary) => {
    if (!ready || upstream?.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      // PCM 16-bit 16 kHz mono do microfone
      upstream.send(JSON.stringify({ realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: (data as Buffer).toString("base64") } } }));
      return;
    }
    try {
      const msg = JSON.parse(data.toString()) as { type?: string; text?: string };
      if (msg.type === "text" && typeof msg.text === "string" && msg.text.trim()) {
        upstream.send(JSON.stringify({ realtimeInput: { text: msg.text.slice(0, 2000) } }));
      } else if (msg.type === "end") {
        shutdown();
      }
    } catch {
      // ignora
    }
  });
}

export function attachLive(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/live") return;
    if (!upgradeAllowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleClient(ws));
  });
}
