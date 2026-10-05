import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AgentService } from "./agent.service";
import { ClaudeCodeService } from "./claude-code/claude-code.service";

@Controller()
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly claudeCode: ClaudeCodeService
  ) {}

  @Get("health")
  health() {
    return { ok: true, service: "planner-agent" };
  }

  @Post("chat")
  async chat(@Body() body: { message?: string }) {
    if (!body?.message) {
      throw new BadRequestException("message e obrigatorio");
    }
    const reply = await this.agentService.chat(body.message);
    return { reply };
  }

  @Get("claude-code/pending")
  listPendingClaudeCode() {
    return this.claudeCode.listPending();
  }

  @Post("claude-code/:id/confirm")
  confirmClaudeCode(@Param("id") id: string) {
    return this.claudeCode.confirm(id);
  }

  @Post("claude-code/:id/reject")
  rejectClaudeCode(@Param("id") id: string) {
    return this.claudeCode.reject(id);
  }

  @Post("claude-code/run")
  runClaudeCode(@Body() body: { prompt?: string; cwd?: string }) {
    if (!body?.prompt?.trim()) {
      throw new BadRequestException("prompt e obrigatorio");
    }
    return this.claudeCode.runNow(body.prompt.trim(), body.cwd);
  }

  @Post("research/request")
  requestResearch(@Body() body: { theme?: string }) {
    if (!body?.theme?.trim()) {
      throw new BadRequestException("theme e obrigatorio");
    }
    return this.claudeCode.createResearchRequest(body.theme.trim());
  }
}
