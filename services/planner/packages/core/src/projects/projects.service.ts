import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";
import * as projectsRepo from "../repositories/projects";

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  list() {
    return projectsRepo.listProjects(this.db);
  }

  create(input: { name: string; goal?: string }) {
    const project = projectsRepo.createProject(this.db, input);
    this.eventsService.record("project.created", {
      projectId: project.id,
      name: project.name,
    });
    this.eventBus.publish("project.created", {
      projectId: project.id,
      name: project.name,
    });
    return project;
  }

  updateProgress(id: string, progress: number) {
    const project = projectsRepo.updateProjectProgress(this.db, id, progress);
    if (!project) {
      throw new NotFoundException("projeto nao encontrado");
    }
    this.eventsService.record("project.updated", { projectId: id, progress });
    this.eventBus.publish("project.updated", { projectId: id, progress });
    return project;
  }

  update(id: string, input: { name?: string; goal?: string; progress?: number }) {
    const project = projectsRepo.updateProject(this.db, id, input);
    if (!project) {
      throw new NotFoundException("projeto nao encontrado");
    }
    this.eventsService.record("project.updated", { projectId: id, progress: project.progress });
    this.eventBus.publish("project.updated", { projectId: id, progress: project.progress });
    return project;
  }

  remove(id: string) {
    const project = projectsRepo.getProject(this.db, id);
    if (!project) {
      throw new NotFoundException("projeto nao encontrado");
    }
    projectsRepo.deleteProject(this.db, id);
    this.eventsService.record("project.deleted", { projectId: id });
    this.eventBus.publish("project.deleted", { projectId: id });
    return { ok: true };
  }
}
