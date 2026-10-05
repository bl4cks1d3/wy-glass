import { BadRequestException, Body, Controller, Get, Patch } from "@nestjs/common";
import { SettingsService } from "./settings.service";

/** Toda chave que a tela de Configuracoes pode ler/editar -- deliberadamente
 * uma lista fechada (nao o .env inteiro), pra nao expor porta/URL interna
 * que o usuario nao devia mexer por essa tela. */
export const SETTINGS_KEYS = [
  "AGENT_PROVIDER",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "PIPER_BIN",
  "PIPER_MODEL",
  "OBSIDIAN_VAULT_PATH",
  "CLAUDE_CODE_CWD",
  "MORNING_BRIEFING_ENABLED",
  "MORNING_BRIEFING_HOUR",
  "EVENT_REMINDER_ENABLED",
  "EVENT_REMINDER_MINUTES",
  "GOOGLE_TASKS_REMINDER_ENABLED",
  "NOTIFICATION_SOUND_ENABLED",
] as const;

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getAll() {
    return this.settings.getAll([...SETTINGS_KEYS]);
  }

  @Patch()
  update(@Body() body: Record<string, string>) {
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
        throw new BadRequestException(`configuracao desconhecida: ${key}`);
      }
      updates[key] = String(value ?? "");
    }
    if (Object.keys(updates).length === 0) {
      throw new BadRequestException("nenhuma configuracao valida enviada");
    }
    this.settings.update(updates);
    return { ok: true };
  }
}
