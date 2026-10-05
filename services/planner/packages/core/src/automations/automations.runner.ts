import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Automation, AutomationNode } from '@planner-life/shared';
import { PlannerEventBus } from '../eventBus';
import { AgentClient } from './agent-client';
import { AutomationsService } from './automations.service';
import { LIMITS } from './catalog';
import { cronMatches, parseCron, type CronSpec } from './cron';

const CATCH_UP_MS = 24 * 60 * 60_000;

/**
 * Dispara as automacoes ativas: agenda (a cada 15 s confere o minuto), "uma vez"
 * (com recuperacao se o computador estava desligado) e eventos do Planner (barramento
 * em processo). Um disjuntor desliga a automacao que dispara demais.
 */
@Injectable()
export class AutomationsRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationsRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private readonly lastFire = new Map<string, string>();
  private readonly bursts = new Map<string, number[]>();
  private readonly cronCache = new Map<string, CronSpec | null>();

  constructor(
    private readonly service: AutomationsService,
    private readonly bus: PlannerEventBus,
    private readonly agent: AgentClient,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 15_000);
    this.timer.unref?.();
    this.bus.on('event', this.onEvent);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.bus.off('event', this.onEvent);
  }

  private cron(expr: string): CronSpec | null {
    if (!this.cronCache.has(expr)) {
      try {
        this.cronCache.set(expr, parseCron(expr));
      } catch {
        this.cronCache.set(expr, null);
      }
    }
    return this.cronCache.get(expr) ?? null;
  }

  async tick(now = new Date()): Promise<void> {
    const pad = (n: number) => String(n).padStart(2, '0');
    const minuteKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    for (const a of this.service.activeAutomations()) {
      for (const n of a.nodes) {
        if (n.type === 'trigger.schedule' && typeof n.config.cron === 'string') {
          const spec = this.cron(n.config.cron);
          const key = `${a.id}:${n.id}`;
          if (spec && cronMatches(spec, now) && this.lastFire.get(key) !== minuteKey) {
            this.lastFire.set(key, minuteKey);
            void this.fire(a, n, { firedAt: now.toISOString(), cron: n.config.cron });
          }
        } else if (
          n.type === 'trigger.once' &&
          typeof n.config.at === 'string' &&
          !n.config.firedAt
        ) {
          const at = new Date(n.config.at).getTime();
          if (!Number.isNaN(at) && at <= now.getTime() && now.getTime() - at <= CATCH_UP_MS) {
            this.service.markOnceFired(a.id, n.id);
            void this.fire(a, n, { firedAt: now.toISOString(), at: n.config.at });
          }
        }
      }
    }
  }

  private readonly onEvent = (evt: { type: string; payload: Record<string, unknown> }): void => {
    for (const a of this.service.activeAutomations()) {
      for (const n of a.nodes) {
        if (n.type !== 'trigger.event' || n.config.event !== evt.type) continue;
        const where = n.config.where;
        if (
          where &&
          typeof where === 'object' &&
          !Object.entries(where as Record<string, unknown>).every(
            ([k, v]) => String(evt.payload[k]) === String(v),
          )
        )
          continue;
        // uma automacao que esta rodando nao se dispara de novo pelos proprios efeitos
        if (this.service.isRunning(a.id)) continue;
        if (this.tripped(a)) continue;
        void this.fire(a, n, { ...evt.payload, event: evt.type });
      }
    }
  };

  /** Disjuntor: muitos disparos em 5 min (laco) desligam a automacao e avisam. */
  private tripped(a: Automation): boolean {
    const now = Date.now();
    const list = (this.bursts.get(a.id) ?? []).filter((t) => now - t < 5 * 60_000);
    list.push(now);
    this.bursts.set(a.id, list);
    if (list.length <= LIMITS.triggerBurst) return false;
    this.service.deactivate(a.id);
    this.logger.warn(
      `automacao "${a.name}" desativada: mais de ${LIMITS.triggerBurst} disparos em 5 min`,
    );
    void this.agent
      .notify(
        'Automação pausada',
        `"${a.name}" disparou mais de ${LIMITS.triggerBurst} vezes em 5 minutos e foi desativada (possível laço).`,
      )
      .catch(() => undefined);
    return true;
  }

  private async fire(
    a: Automation,
    trigger: AutomationNode,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const run = await this.service.run(a.id, {
        mode: 'live',
        triggerNodeId: trigger.id,
        payload,
      });
      if (run.status === 'error') {
        void this.agent
          .notify(`Automação falhou: ${a.name}`, run.error ?? 'erro')
          .catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(`"${a.name}" nao executou: ${err instanceof Error ? err.message : err}`);
    }
  }
}
