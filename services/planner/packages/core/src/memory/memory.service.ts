import { Inject, Injectable } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as memoryRepo from "../repositories/memory";

@Injectable()
export class MemoryService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list(limit = 100) {
    return memoryRepo.listMemory(this.db, limit);
  }

  create(input: { content: string; tags?: string[]; source?: string }) {
    const entry = memoryRepo.createMemory(this.db, input);
    this.eventsService.record("memory.created", { memoryId: entry.id });
    this.eventBus.publish("memory.created", { memoryId: entry.id });
    return entry;
  }

  remove(id: string) {
    memoryRepo.deleteMemory(this.db, id);
    this.eventsService.record("memory.deleted", { memoryId: id });
    this.eventBus.publish("memory.deleted", { memoryId: id });
    return { ok: true };
  }
}
