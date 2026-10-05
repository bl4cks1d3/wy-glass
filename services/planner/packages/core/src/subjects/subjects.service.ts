import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as subjectsRepo from "../repositories/subjects";

@Injectable()
export class SubjectsService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list() {
    return subjectsRepo.listSubjects(this.db);
  }

  create(input: { name: string; note?: string; examDate?: string }) {
    const subject = subjectsRepo.createSubject(this.db, input);
    this.eventsService.record("subject.created", { subjectId: subject.id, name: subject.name });
    this.eventBus.publish("subject.created", { subjectId: subject.id, name: subject.name });
    return subject;
  }

  update(id: string, input: { progress?: number; note?: string; examDate?: string | null }) {
    const subject = subjectsRepo.updateSubject(this.db, id, input);
    if (!subject) {
      throw new NotFoundException("disciplina nao encontrada");
    }
    this.eventsService.record("subject.updated", { subjectId: id, progress: subject.progress });
    this.eventBus.publish("subject.updated", { subjectId: id, progress: subject.progress });
    return subject;
  }

  remove(id: string) {
    subjectsRepo.deleteSubject(this.db, id);
    this.eventsService.record("subject.deleted", { subjectId: id });
    this.eventBus.publish("subject.deleted", { subjectId: id });
    return { ok: true };
  }
}
