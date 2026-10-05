import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { assertLocalCaller, type LocalRequest as Request } from './local-guard';
import { AgentService } from './agent.service';
import { ClaudeCodeService } from './claude-code/claude-code.service';
import { ToolRegistry } from './tool-registry';

/** Ferramentas que um bloco de dashboard NUNCA pode chamar, mesmo que declare. */
const BLOCKED_FOR_BLOCKS = new Set(['run_claude_code', 'use_skill']);

@Controller()
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly claudeCode: ClaudeCodeService,
    private readonly registry: ToolRegistry,
  ) {}

  @Get('health')
  health() {
    return { ok: true, service: 'planner-agent' };
  }

  @Post('chat')
  async chat(@Body() body: { message?: string }) {
    if (!body?.message) {
      throw new BadRequestException('message e obrigatorio');
    }
    const reply = await this.agentService.chat(body.message);
    return { reply };
  }

  @Get('tools')
  listTools(@Req() req: Request) {
    assertLocalCaller(req);
    return this.registry
      .list()
      .filter((t) => !BLOCKED_FOR_BLOCKS.has(t.name))
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
  }

  @Post('tools/call')
  async callTool(
    @Req() req: Request,
    @Body() body: { name?: string; args?: Record<string, unknown> },
  ) {
    assertLocalCaller(req);
    const name = body?.name;
    if (!name || typeof name !== 'string') throw new BadRequestException('name e obrigatorio');
    if (BLOCKED_FOR_BLOCKS.has(name))
      throw new ForbiddenException(`a ferramenta ${name} nao pode ser chamada por aqui`);
    if (!this.registry.list().some((t) => t.name === name))
      throw new BadRequestException(`ferramenta desconhecida: ${name}`);
    try {
      return {
        result: await this.registry.call(
          name,
          body.args && typeof body.args === 'object' ? body.args : {},
        ),
      };
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }
  }

  @Get('claude-code/pending')
  listPendingClaudeCode() {
    return this.claudeCode.listPending();
  }

  @Post('claude-code/:id/confirm')
  confirmClaudeCode(@Param('id') id: string) {
    return this.claudeCode.confirm(id);
  }

  @Post('claude-code/:id/reject')
  rejectClaudeCode(@Param('id') id: string) {
    return this.claudeCode.reject(id);
  }

  @Post('claude-code/run')
  runClaudeCode(@Body() body: { prompt?: string; cwd?: string }) {
    if (!body?.prompt?.trim()) {
      throw new BadRequestException('prompt e obrigatorio');
    }
    return this.claudeCode.runNow(body.prompt.trim(), body.cwd);
  }

  @Post('research/request')
  requestResearch(@Body() body: { theme?: string }) {
    if (!body?.theme?.trim()) {
      throw new BadRequestException('theme e obrigatorio');
    }
    return this.claudeCode.createResearchRequest(body.theme.trim());
  }
}
