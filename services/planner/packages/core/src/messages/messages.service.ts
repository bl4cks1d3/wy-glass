import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as messagesRepo from "../repositories/messages";

@Injectable()
export class MessagesService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list() {
    return messagesRepo.listMessages(this.db);
  }

  get(id: string) {
    return messagesRepo.getMessage(this.db, id);
  }

  /**
   * Usado tanto por uma futura sincronizacao com o Gmail (um id externo do
   * provedor evita duplicar a mesma mensagem a cada sync) quanto por
   * qualquer outra fonte que queira alimentar o inbox do Planner Life.
   */
  upsert(input: {
    id?: string;
    from: string;
    subject: string;
    snippet?: string;
    tag?: string;
    action?: string;
    receivedAt: string;
  }) {
    const message = messagesRepo.upsertMessage(this.db, input);
    this.eventsService.record("message.synced", { messageId: message.id, from: message.from });
    this.eventBus.publish("message.synced", { messageId: message.id, from: message.from });
    return message;
  }

  setHandled(id: string, handled: boolean) {
    const message = messagesRepo.setMessageHandled(this.db, id, handled);
    if (!message) {
      throw new NotFoundException("mensagem nao encontrada");
    }
    this.eventsService.record("message.handled", { messageId: id, handled });
    this.eventBus.publish("message.handled", { messageId: id, handled });
    return message;
  }

  remove(id: string) {
    messagesRepo.deleteMessage(this.db, id);
    this.eventsService.record("message.deleted", { messageId: id });
    this.eventBus.publish("message.deleted", { messageId: id });
  }

  /**
   * So apaga a copia local do inbox (tabela messages) -- nunca chama a API
   * do Gmail, entao a caixa de e-mail de verdade do usuario nunca e tocada.
   * Uma proxima sincronizacao traz de volta o que ainda estiver no Gmail.
   */
  clearAll() {
    const count = messagesRepo.clearMessages(this.db);
    this.eventsService.record("message.deleted", { count, all: true });
    this.eventBus.publish("message.deleted", { count, all: true });
    return { cleared: count };
  }
}
