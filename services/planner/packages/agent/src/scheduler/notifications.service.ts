import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface AgentNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  seen: boolean;
}

/**
 * Fila simples em memoria (mesmo padrao do ClaudeCodeService) -- o app
 * desktop (Electron) e o dashboard fazem polling em /notifications/pending
 * e mostram como notificacao nativa / aviso na tela. E o que faz o Jarvis
 * avisar sozinho em vez de so responder quando perguntado.
 */
@Injectable()
export class NotificationsService {
  private readonly items: AgentNotification[] = [];

  push(title: string, body: string): AgentNotification {
    const notification: AgentNotification = {
      id: randomUUID(),
      title,
      body,
      createdAt: new Date().toISOString(),
      seen: false,
    };
    this.items.unshift(notification);
    this.items.length = Math.min(this.items.length, 50);
    return notification;
  }

  listPending(): AgentNotification[] {
    return this.items.filter((n) => !n.seen);
  }

  ack(id: string): void {
    const notification = this.items.find((n) => n.id === id);
    if (notification) notification.seen = true;
  }
}
