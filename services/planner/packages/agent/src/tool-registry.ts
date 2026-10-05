import { Injectable } from "@nestjs/common";
import { AGENT_TOOLS, SYSTEM_PROMPT, runTool, type AgentTool } from "./tools";
import { McpManager } from "./mcp/mcp-manager";
import { SkillsManager } from "./skills/skills-manager";
import { ClaudeCodeService } from "./claude-code/claude-code.service";

/**
 * Ponto unico de ferramentas que os providers de LLM enxergam: combina as
 * ferramentas nativas do Planner Core, a ferramenta use_skill (se houver
 * skills carregadas) e as ferramentas de qualquer servidor MCP conectado.
 * Isso e o que faz o agente ser um harness -- ele nao sabe de onde cada
 * ferramenta veio, so sabe listar e chamar.
 */
@Injectable()
export class ToolRegistry {
  constructor(
    private readonly mcp: McpManager,
    private readonly skills: SkillsManager,
    private readonly claudeCode: ClaudeCodeService
  ) {}

  list(): AgentTool[] {
    return [...AGENT_TOOLS, ...this.skills.listTools(), ...this.mcp.listTools()];
  }

  call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name.startsWith("mcp__")) {
      return this.mcp.callTool(name, args);
    }
    if (name === "use_skill") {
      return Promise.resolve(this.skills.getContent(args.name as string));
    }
    if (name === "run_claude_code") {
      const action = this.claudeCode.createPending(
        String(args.prompt ?? ""),
        typeof args.cwd === "string" ? args.cwd : undefined
      );
      return Promise.resolve({
        status: "aguardando_confirmacao",
        actionId: action.id,
        aviso: "Pedido registrado no dashboard. Nada foi executado ainda -- o usuario precisa confirmar.",
      });
    }
    return runTool(name, args);
  }

  systemPrompt(): string {
    const addendum = this.skills.describeAvailable();
    return addendum ? `${SYSTEM_PROMPT}\n\n${addendum}` : SYSTEM_PROMPT;
  }
}
