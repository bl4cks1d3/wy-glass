export interface LlmProvider {
  readonly name: string;
  chat(userMessage: string): Promise<string>;
}
