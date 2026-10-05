import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as clientsRepo from "../repositories/clients";
import type { ClientStage } from "@planner-life/shared";

@Injectable()
export class ClientsService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list() {
    return clientsRepo.listClients(this.db);
  }

  create(input: { name: string; stage?: ClientStage; value?: number; nextAction?: string; nextActionAt?: string }) {
    const client = clientsRepo.createClient(this.db, input);
    this.eventsService.record("client.created", { clientId: client.id, name: client.name });
    this.eventBus.publish("client.created", { clientId: client.id, name: client.name });
    return client;
  }

  update(
    id: string,
    input: { stage?: ClientStage; value?: number; nextAction?: string; nextActionAt?: string }
  ) {
    const client = clientsRepo.updateClient(this.db, id, input);
    if (!client) {
      throw new NotFoundException("cliente nao encontrado");
    }
    this.eventsService.record("client.updated", { clientId: id, stage: client.stage });
    this.eventBus.publish("client.updated", { clientId: id, stage: client.stage });
    return client;
  }

  remove(id: string) {
    clientsRepo.deleteClient(this.db, id);
    this.eventsService.record("client.deleted", { clientId: id });
    this.eventBus.publish("client.deleted", { clientId: id });
    return { ok: true };
  }
}
