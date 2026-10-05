import { Injectable, Logger } from "@nestjs/common";
import { createLlmProvider, type LlmProvider } from "./providers";
import { ToolRegistry } from "./tool-registry";

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private provider: LlmProvider | undefined;

  constructor(private readonly registry: ToolRegistry) {}

  /**
   * O provider e escolhido na primeira mensagem (nao no construtor), assim
   * o servico sobe e /health responde mesmo sem nenhuma chave de API
   * configurada ainda.
   */
  private getProvider(): LlmProvider {
    if (!this.provider) {
      this.provider = createLlmProvider(this.registry);
      this.logger.log(`usando provider de IA: ${this.provider.name}`);
    }
    return this.provider;
  }

  chat(userMessage: string): Promise<string> {
    return this.getProvider().chat(userMessage);
  }
}
