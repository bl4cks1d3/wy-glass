import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as tasksRepo from "../repositories/tasks";
import type { TaskStatus } from "@planner-life/shared";

@Injectable()
export class TasksService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list(filter?: { status?: TaskStatus; projectId?: string }) {
    return tasksRepo.listTasks(this.db, filter);
  }

  create(input: { title: string; projectId?: string; dueAt?: string; notes?: string }) {
    const task = tasksRepo.createTask(this.db, input);
    this.eventsService.record("task.created", { taskId: task.id, title: task.title });
    this.eventBus.publish("task.created", { taskId: task.id, title: task.title });
    return task;
  }

  updateStatus(id: string, status: TaskStatus) {
    const task = tasksRepo.updateTaskStatus(this.db, id, status);
    if (!task) {
      throw new NotFoundException("tarefa nao encontrada");
    }
    const eventType = status === "done" ? "task.completed" : "task.updated";
    this.eventsService.record(eventType, { taskId: id, status });
    this.eventBus.publish(eventType, { taskId: id, status });
    return task;
  }

  update(id: string, input: { title?: string; projectId?: string | null; dueAt?: string | null; notes?: string | null }) {
    const task = tasksRepo.updateTask(this.db, id, input);
    if (!task) {
      throw new NotFoundException("tarefa nao encontrada");
    }
    this.eventsService.record("task.updated", { taskId: id });
    this.eventBus.publish("task.updated", { taskId: id });
    return task;
  }

  remove(id: string) {
    const task = tasksRepo.getTask(this.db, id);
    if (!task) {
      throw new NotFoundException("tarefa nao encontrada");
    }
    tasksRepo.deleteTask(this.db, id);
    this.eventsService.record("task.deleted", { taskId: id });
    this.eventBus.publish("task.deleted", { taskId: id });
    return { ok: true };
  }
}
