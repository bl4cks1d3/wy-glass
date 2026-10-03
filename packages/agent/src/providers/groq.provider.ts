import { InternalServerErrorException, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import type { ToolRegistry } from '../tool-registry';
import type { AgentTool } from '../tools';
import type { LlmProvider } from './types';

// Modelos do Groq mudam com frequencia (tiers gratuitos sao promovidos/
// aposentados sem muito aviso). Confira a lista atual em
// https://console.groq.com/docs/models e ajuste via GROQ_MODEL se preciso.
const MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

const MISSING_KEY_MESSAGE =
  'GROQ_API_KEY nao configurada. Configure GROQ_API_KEY, GEMINI_API_KEY ou ANTHROPIC_API_KEY no .env (veja .env.example) e ajuste AGENT_PROVIDER se necessario.';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// O free tier do Groq recusa (413) requisicoes acima de ~8000 tokens. Ferramentas + historico
// passam de 30 mil caracteres facilmente, entao os turnos mais antigos saem do historico.
// Suba GROQ_MAX_REQUEST_CHARS se voce usa um plano/modelo com limite maior.
const MAX_REQUEST_CHARS = Number(process.env.GROQ_MAX_REQUEST_CHARS ?? 30_000);

function trimHistory(history: ChatMessage[], toolsChars: number): void {
  while (toolsChars + JSON.stringify(history).length > MAX_REQUEST_CHARS) {
    // remove o turno mais antigo (da 1a mensagem do usuario ate a anterior a proxima); nunca o turno atual
    const next = history.findIndex((m, i) => i > 1 && m.role === 'user');
    if (next === -1) return;
    history.splice(1, next - 1);
  }
}

function toOpenAiTools(tools: AgentTool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Groq expoe uma API compativel com a da OpenAI (chat completions + tool
 * calling), so que rodando modelos abertos (Llama etc.) com free tier
 * generoso e latencia muito baixa. Por isso usamos o SDK "openai" apontado
 * para o baseURL do Groq, em vez de escrever um cliente HTTP a mao.
 */
export class GroqProvider implements LlmProvider {
  readonly name = 'groq';
  private readonly logger = new Logger('GroqProvider');
  private readonly history: ChatMessage[];
  private client: OpenAI | undefined;

  constructor(private readonly registry: ToolRegistry) {
    this.history = [{ role: 'system', content: registry.systemPrompt() }];
  }

  private getClient(): OpenAI {
    if (!process.env.GROQ_API_KEY) {
      throw new InternalServerErrorException(MISSING_KEY_MESSAGE);
    }
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    }
    return this.client;
  }

  async chat(userMessage: string): Promise<string> {
    const client = this.getClient();
    this.history.push({ role: 'user', content: userMessage });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const tools = toOpenAiTools(this.registry.list());
      trimHistory(this.history, JSON.stringify(tools).length);
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: this.history,
        tools,
      });

      const message = completion.choices[0].message;
      this.history.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return message.content ?? '';
      }

      for (const call of message.tool_calls) {
        if (call.type !== 'function') continue;
        this.logger.log(`ferramenta: ${call.function.name} ${call.function.arguments}`);
        let result: unknown;
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          result = await this.registry.call(call.function.name, args);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }
  }
}
