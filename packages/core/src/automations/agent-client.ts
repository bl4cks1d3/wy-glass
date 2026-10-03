import { Injectable } from '@nestjs/common';

const AGENT_URL = (
  process.env.AGENT_API_URL ?? `http://localhost:${process.env.AGENT_PORT ?? '4100'}`
).replace(/\/$/, '');
const TOOLS_TTL_MS = 30_000;

export interface AgentToolInfo {
  name: string;
  description: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}

async function agentFetch(
  path: string,
  init: RequestInit & { timeoutMs: number },
): Promise<unknown> {
  const { timeoutMs, ...rest } = init;
  const res = await fetch(`${AGENT_URL}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
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
    throw new Error(
      Array.isArray(message)
        ? message.join('; ')
        : (message ?? `Agent respondeu ${res.status}: ${raw.slice(0, 200)}`),
    );
  }
  return parsed;
}

/**
 * Ponte Core -> Agent. As ferramentas (nativas, skills e de servidores MCP
 * externos) vivem no Agent; a automacao so chama por nome, sem saber de onde
 * vieram. O Agent so aceita /tools de loopback e recusa run_claude_code/use_skill.
 */
@Injectable()
export class AgentClient {
  private cache: { at: number; tools: AgentToolInfo[] } | undefined;

  /** Catalogo de ferramentas (cache curto). undefined = Agent fora do ar. */
  async listTools(): Promise<AgentToolInfo[] | undefined> {
    if (this.cache && Date.now() - this.cache.at < TOOLS_TTL_MS) return this.cache.tools;
    try {
      const tools = (await agentFetch('/tools', {
        method: 'GET',
        timeoutMs: 4000,
      })) as AgentToolInfo[];
      this.cache = { at: Date.now(), tools };
      return tools;
    } catch {
      return this.cache?.tools;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const out = (await agentFetch('/tools/call', {
      method: 'POST',
      body: JSON.stringify({ name, args }),
      timeoutMs: 60_000,
    })) as {
      result?: unknown;
    } | null;
    return out?.result ?? null;
  }

  async chat(message: string): Promise<string> {
    const out = (await agentFetch('/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
      timeoutMs: 120_000,
    })) as {
      reply?: string;
    } | null;
    return out?.reply ?? '';
  }

  async notify(title: string, body: string): Promise<void> {
    await agentFetch('/notifications', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
      timeoutMs: 10_000,
    });
  }
}
