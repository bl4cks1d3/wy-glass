import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { NotificationsService } from "./notifications.service";

const CORE_API_URL = process.env.CORE_API_URL ?? "http://localhost:4000";
const AGENT_PORT = process.env.AGENT_PORT ?? "4100";

interface UpcomingEvent {
  id: string;
  title: string;
  start: string;
}

interface GoogleTaskLike {
  id: string;
  title: string;
  due?: string;
  status: "needsAction" | "completed";
}

interface SettingField {
  key: string;
  value: string | null;
}

/**
 * Rotinas proativas: o Jarvis nao fica so esperando voce perguntar. Resumo
 * da manha e aviso antes de cada compromisso -- as duas usam a fila de
 * notificacoes (NotificationsService), que o app desktop/dashboard
 * consomem via polling. Horario/liga-desliga vem da aba Configuracoes
 * (guardado no .env pelo Core) -- por isso os crons rodam com frequencia
 * maior que o evento em si e decidem, a cada tick, se e a hora certa.
 *
 * Chama o proprio /chat via HTTP (em vez de injetar AgentService por DI)
 * porque AgentService vive no AppModule raiz e nao e exportado -- e o
 * mesmo padrao ja usado aqui pra falar com o Core.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly remindedEventIds = new Set<string>();
  private readonly lastTaskReminderAt = new Map<string, number>();
  private lastBriefingDate = "";

  constructor(private readonly notifications: NotificationsService) {}

  private async getSettings(): Promise<Record<string, string>> {
    try {
      const res = await fetch(`${CORE_API_URL}/settings`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return {};
      const fields = (await res.json()) as SettingField[];
      return Object.fromEntries(fields.map((f) => [f.key, f.value ?? ""]));
    } catch {
      return {};
    }
  }

  @Cron("*/10 * * * *")
  async morningBriefing(): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (settings.MORNING_BRIEFING_ENABLED === "false") return;
      const hour = Number(settings.MORNING_BRIEFING_HOUR || "8");
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      if (now.getHours() !== hour || this.lastBriefingDate === today) return;
      this.lastBriefingDate = today;

      const res = await fetch(`http://localhost:${AGENT_PORT}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:
            "Bom dia. Resuma rapidamente: tarefas pendentes, compromissos de hoje e por onde comecar. Seja breve (max 4 frases).",
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json()) as { reply?: string };
      if (data.reply) this.notifications.push("Bom dia", data.reply);
    } catch (err) {
      this.logger.error(`falha no resumo da manha: ${err instanceof Error ? err.message : err}`);
    }
  }

  @Cron("*/5 * * * *")
  async upcomingEvents(): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (settings.EVENT_REMINDER_ENABLED === "false") return;
      const leadMinutes = Number(settings.EVENT_REMINDER_MINUTES || "15");

      const res = await fetch(`${CORE_API_URL}/integrations/google/calendar?limit=20`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const events = (await res.json()) as UpcomingEvent[];
      const now = Date.now();
      for (const ev of events) {
        const minutesUntil = (new Date(ev.start).getTime() - now) / 60_000;
        if (minutesUntil > 0 && minutesUntil <= leadMinutes && !this.remindedEventIds.has(ev.id)) {
          this.remindedEventIds.add(ev.id);
          this.notifications.push("Compromisso em breve", `${ev.title} em ${Math.round(minutesUntil)} min`);
        }
      }
    } catch (err) {
      this.logger.debug(`falha ao checar proximos eventos: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Google Tasks so guarda uma DATA (sem horario), entao nao tem "faltam
   * X minutos" igual ao Calendar -- e so "atrasada" ou "vence hoje".
   * Enquanto a tarefa continuar na lista (nao concluida), repete o aviso
   * a cada 1h -- diferente do Calendar/resumo, que avisam uma vez so.
   * Task concluida sai da lista e para de avisar sozinha.
   */
  @Cron("*/10 * * * *")
  async googleTasksReminders(): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (settings.GOOGLE_TASKS_REMINDER_ENABLED === "false") return;

      const res = await fetch(`${CORE_API_URL}/integrations/google/tasks`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return;
      const tasks = (await res.json()) as GoogleTaskLike[];
      const today = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      const HOUR_MS = 60 * 60 * 1000;

      for (const task of tasks) {
        if (task.status === "completed" || !task.due) continue;
        const dueDate = task.due.slice(0, 10);
        if (dueDate > today) continue;
        const lastAt = this.lastTaskReminderAt.get(task.id);
        if (lastAt !== undefined && now - lastAt < HOUR_MS) continue;
        this.lastTaskReminderAt.set(task.id, now);
        const label = dueDate < today ? "Tarefa atrasada" : "Tarefa vence hoje";
        this.notifications.push(label, task.title);
      }
    } catch (err) {
      this.logger.debug(`falha ao checar tarefas do Google: ${err instanceof Error ? err.message : err}`);
    }
  }
}
