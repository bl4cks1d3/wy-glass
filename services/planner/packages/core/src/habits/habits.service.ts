import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as habitsRepo from "../repositories/habits";

@Injectable()
export class HabitsService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list() {
    return habitsRepo.listHabits(this.db);
  }

  create(input: { name: string; unit?: string; target?: number }) {
    const habit = habitsRepo.createHabit(this.db, input);
    this.eventsService.record("habit.created", { habitId: habit.id, name: habit.name });
    this.eventBus.publish("habit.created", { habitId: habit.id, name: habit.name });
    return habit;
  }

  update(id: string, input: { current?: number; target?: number }) {
    const habit = habitsRepo.updateHabit(this.db, id, input);
    if (!habit) {
      throw new NotFoundException("habito nao encontrado");
    }
    this.eventsService.record("habit.updated", { habitId: id, current: habit.current });
    this.eventBus.publish("habit.updated", { habitId: id, current: habit.current });
    return habit;
  }

  remove(id: string) {
    const habit = habitsRepo.getHabit(this.db, id);
    if (!habit) {
      throw new NotFoundException("habito nao encontrado");
    }
    habitsRepo.deleteHabit(this.db, id);
    this.eventsService.record("habit.deleted", { habitId: id });
    this.eventBus.publish("habit.deleted", { habitId: id });
    return { ok: true };
  }
}
