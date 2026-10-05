import { Inject, Injectable } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import * as eventsRepo from "../repositories/events";
import type { PlpEventType } from "@planner-life/shared";

@Injectable()
export class EventsService {
  constructor(@Inject(PLANNER_DB) private readonly db: PlannerDb) {}

  record(type: PlpEventType, payload: Record<string, unknown>, origin?: string) {
    return eventsRepo.recordEvent(this.db, type, payload, origin);
  }

  list(limit = 50) {
    return eventsRepo.listEvents(this.db, limit);
  }
}
