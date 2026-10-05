import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PlannerEventBus } from "../eventBus";
import type { PlpEventType } from "@planner-life/shared";

/**
 * Encaminha tudo que passa pelo PlannerEventBus para o no P2P local (via o
 * bridge HTTP dele, ver packages/p2p-node/src/http-bridge.ts), que publica
 * de verdade no topico PLP via gossipsub. Sem isso, os eventos do core
 * nunca saiam do processo -- essa e a peca que fecha o "core -> p2p-node"
 * da visao do projeto.
 *
 * Se o no P2P nao estiver rodando, o fetch falha silenciosamente (so um
 * log em debug): o Planner Core precisa funcionar sozinho, com ou sem rede
 * P2P ativa.
 */
@Injectable()
export class P2pBridgeService implements OnModuleInit {
  private readonly logger = new Logger(P2pBridgeService.name);

  constructor(private readonly eventBus: PlannerEventBus) {}

  private get bridgeUrl(): string {
    return process.env.P2P_NODE_HTTP_URL ?? "http://127.0.0.1:4401";
  }

  onModuleInit(): void {
    this.eventBus.on("event", (event: { type: PlpEventType; payload: Record<string, unknown> }) => {
      this.forward(event).catch(() => undefined);
    });
  }

  private async forward(event: { type: PlpEventType; payload: Record<string, unknown> }): Promise<void> {
    try {
      await fetch(`${this.bridgeUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      this.logger.debug(`no P2P indisponivel, evento "${event.type}" ficou so local`);
    }
  }
}
