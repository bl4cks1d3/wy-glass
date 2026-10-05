import { InternalServerErrorException, Logger } from "@nestjs/common";
import {
  GoogleGenerativeAI,
  type ChatSession,
  type FunctionDeclaration,
  type Part,
} from "@google/generative-ai";
import type { ToolRegistry } from "../tool-registry";
import type { AgentTool } from "../tools";
import type { LlmProvider } from "./types";

// Assim como o Groq, os nomes de modelo do Gemini mudam com o tempo.
// Confira o catalogo atual (e o que esta no free tier) em
// https://ai.google.dev/gemini-api/docs/models e ajuste via GEMINI_MODEL.
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

const MISSING_KEY_MESSAGE =
  "GEMINI_API_KEY nao configurada. Configure GROQ_API_KEY, GEMINI_API_KEY ou ANTHROPIC_API_KEY no .env (veja .env.example) e ajuste AGENT_PROVIDER se necessario.";

function toGeminiTools(tools: AgentTool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: tool.parameters as any,
  }));
}

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  private readonly logger = new Logger("GeminiProvider");
  private session: ChatSession | undefined;

  constructor(private readonly registry: ToolRegistry) {}

  private getSession(): ChatSession {
    if (!process.env.GEMINI_API_KEY) {
      throw new InternalServerErrorException(MISSING_KEY_MESSAGE);
    }
    if (!this.session) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: this.registry.systemPrompt(),
        tools: [{ functionDeclarations: toGeminiTools(this.registry.list()) }],
      });
      this.session = model.startChat();
    }
    return this.session;
  }

  async chat(userMessage: string): Promise<string> {
    const chat = this.getSession();
    let result = await chat.sendMessage(userMessage);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) {
        return result.response.text();
      }

      const responses: Part[] = [];
      for (const call of calls) {
        this.logger.log(`ferramenta: ${call.name} ${JSON.stringify(call.args)}`);
        let toolResult: unknown;
        try {
          toolResult = await this.registry.call(call.name, call.args as Record<string, unknown>);
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : String(err) };
        }
        responses.push({
          functionResponse: { name: call.name, response: { result: toolResult } },
        });
      }

      result = await chat.sendMessage(responses);
    }
  }
}
