import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { ToolRegistry } from "./tool-registry";
import { McpManager } from "./mcp/mcp-manager";
import { SkillsManager } from "./skills/skills-manager";
import { ClaudeCodeService } from "./claude-code/claude-code.service";
import { SchedulerModule } from "./scheduler/scheduler.module";

@Module({
  imports: [SchedulerModule],
  controllers: [AgentController],
  providers: [AgentService, ToolRegistry, McpManager, SkillsManager, ClaudeCodeService],
})
export class AppModule {}
