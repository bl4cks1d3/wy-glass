import { Inject, Injectable } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as studyRepo from "../repositories/study";

@Injectable()
export class StudyService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  listTopics(subjectId?: string) {
    return studyRepo.listTopics(this.db, subjectId);
  }

  createTopic(input: { subjectId: string; title: string; dueAt?: string }) {
    const topic = studyRepo.createTopic(this.db, input);
    this.eventsService.record("study_topic.created", { topicId: topic.id, subjectId: topic.subjectId });
    this.eventBus.publish("study_topic.created", { topicId: topic.id, subjectId: topic.subjectId });
    return topic;
  }

  setTopicDone(id: string, done: boolean) {
    const topic = studyRepo.setTopicDone(this.db, id, done);
    this.eventsService.record("study_topic.updated", { topicId: id, done });
    this.eventBus.publish("study_topic.updated", { topicId: id, done });
    return topic;
  }

  deleteTopic(id: string) {
    studyRepo.deleteTopic(this.db, id);
    this.eventsService.record("study_topic.deleted", { topicId: id });
    this.eventBus.publish("study_topic.deleted", { topicId: id });
    return { ok: true };
  }

  listSchedule() {
    return studyRepo.listScheduleBlocks(this.db);
  }

  createScheduleBlock(input: { subjectId: string; dayOfWeek: number; startTime: string; endTime: string }) {
    const block = studyRepo.createScheduleBlock(this.db, input);
    this.eventsService.record("schedule_block.created", { blockId: block.id, subjectId: block.subjectId });
    this.eventBus.publish("schedule_block.created", { blockId: block.id, subjectId: block.subjectId });
    return block;
  }

  deleteScheduleBlock(id: string) {
    studyRepo.deleteScheduleBlock(this.db, id);
    this.eventsService.record("schedule_block.deleted", { blockId: id });
    this.eventBus.publish("schedule_block.deleted", { blockId: id });
    return { ok: true };
  }

  listSessions(sinceDays?: number) {
    return studyRepo.listSessions(this.db, sinceDays);
  }

  createSession(input: { subjectId?: string; durationMinutes: number; startedAt: string; endedAt: string }) {
    const session = studyRepo.createSession(this.db, input);
    this.eventsService.record("study_session.created", {
      sessionId: session.id,
      subjectId: session.subjectId,
      durationMinutes: session.durationMinutes,
    });
    this.eventBus.publish("study_session.created", {
      sessionId: session.id,
      subjectId: session.subjectId,
      durationMinutes: session.durationMinutes,
    });
    return session;
  }

  deleteSession(id: string) {
    studyRepo.deleteSession(this.db, id);
    this.eventsService.record("study_session.deleted", { sessionId: id });
    this.eventBus.publish("study_session.deleted", { sessionId: id });
    return { ok: true };
  }
}
