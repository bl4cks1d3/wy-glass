import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { AgentTool } from "../tools";

// Mesma convencao do .mcp.json do Claude Code, pra quem ja usa isso ficar
// em casa: { "mcpServers": { "nome": { "command": ..., "args": [...] } } }
const CONFIG_PATH = resolve(__dirname, "../../../../.mcp.json");

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  tools: McpTool[];
}

/**
 * Torna o Personal Agent um host MCP: conecta em servidores MCP externos
 * configurados em .mcp.json (na raiz do projeto) e expoe as ferramentas
 * deles junto com as ferramentas nativas do Planner Core. Cada ferramenta
 * de um servidor "foo" fica disponivel para o LLM como "mcp__foo__<tool>",
 * a mesma convencao de nomes usada pelo proprio Claude Code.
 */
@Injectable()
export class McpManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpManager.name);
  private readonly servers: ConnectedServer[] = [];

  async onModuleInit(): Promise<void> {
    if (!existsSync(CONFIG_PATH)) return;

    let config: McpConfigFile;
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch (err) {
      this.logger.warn(`Nao foi possivel ler .mcp.json: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const entries = Object.entries(config.mcpServers ?? {});
    await Promise.all(entries.map(([name, serverConfig]) => this.connectServer(name, serverConfig)));
  }

  private async connectServer(name: string, serverConfig: McpServerConfig): Promise<void> {
    try {
      const client = new Client({ name: "planner-life-agent", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      });
      await client.connect(transport);
      const { tools } = await client.listTools();
      this.servers.push({ name, client, tools });
      this.logger.log(`MCP conectado: ${name} (${tools.length} ferramenta(s))`);
    } catch (err) {
      this.logger.warn(
        `Falha ao conectar no servidor MCP "${name}": ${err instanceof Error ? err.message : err}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.servers.map((server) => server.client.close().catch(() => undefined)));
  }

  listTools(): AgentTool[] {
    return this.servers.flatMap((server) =>
      server.tools.map((tool) => ({
        name: `mcp__${server.name}__${tool.name}`,
        description: tool.description ?? "",
        parameters: tool.inputSchema as AgentTool["parameters"],
      }))
    );
  }

  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<unknown> {
    const match = prefixedName.match(/^mcp__(.+?)__(.+)$/);
    if (!match) {
      throw new Error(`nome de ferramenta MCP invalido: ${prefixedName}`);
    }
    const [, serverName, toolName] = match;
    const server = this.servers.find((s) => s.name === serverName);
    if (!server) {
      throw new Error(`servidor MCP nao encontrado ou nao conectado: ${serverName}`);
    }

    const result = await server.client.callTool({ name: toolName, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return text || result;
  }
}
