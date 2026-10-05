import { AnthropicProvider } from "./anthropic.provider";
import { GroqProvider } from "./groq.provider";
import { GeminiProvider } from "./gemini.provider";
import type { ToolRegistry } from "../tool-registry";
import type { LlmProvider } from "./types";

export type ProviderName = "groq" | "gemini" | "anthropic";

const PROVIDER_NAMES: ProviderName[] = ["groq", "gemini", "anthropic"];

/**
 * Escolhe o provider de IA. Se AGENT_PROVIDER estiver definido, usa ele.
 * Caso contrario, detecta pela primeira chave de API disponivel, priorizando
 * as opcoes de free tier (Groq, depois Gemini) antes da Anthropic (paga).
 */
function detectProviderName(): ProviderName {
  const explicit = process.env.AGENT_PROVIDER?.toLowerCase();
  if (PROVIDER_NAMES.includes(explicit as ProviderName)) {
    return explicit as ProviderName;
  }
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "groq";
}

export function createLlmProvider(registry: ToolRegistry): LlmProvider {
  switch (detectProviderName()) {
    case "groq":
      return new GroqProvider(registry);
    case "gemini":
      return new GeminiProvider(registry);
    case "anthropic":
      return new AnthropicProvider(registry);
  }
}

export type { LlmProvider } from "./types";
