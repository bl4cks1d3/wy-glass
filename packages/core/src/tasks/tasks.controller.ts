import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import type { TaskStatus } from "@planner-life/shared";

const VALID_STATUSES: TaskStatus[] = ["pending", "in_progress", "done", "cancelled"];

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@Query("status") status?: string, @Query("projectId") projectId?: string) {
    return this.tasksService.list({
      status: status as TaskStatus | undefined,
      projectId,
    });
  }

  @Post()
  create(
    @Body()
    body: { title?: string; projectId?: string; dueAt?: string; notes?: string }
  ) {
    if (!body?.title) {
      throw new BadRequestException("title e obrigatorio");
    }
    return this.tasksService.create({
      title: body.title,
      projectId: body.projectId,
      dueAt: body.dueAt,
      notes: body.notes,
    });
  }

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() body: { status?: string }) {
    if (!body?.status || !VALID_STATUSES.includes(body.status as TaskStatus)) {
      throw new BadRequestException("status invalido");
    }
    return this.tasksService.updateStatus(id, body.status as TaskStatus);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: { title?: string; projectId?: string | null; dueAt?: string | null; notes?: string | null }
  ) {
    return this.tasksService.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.tasksService.remove(id);
  }
}
