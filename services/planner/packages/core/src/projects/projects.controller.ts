import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list() {
    return this.projectsService.list();
  }

  @Post()
  create(@Body() body: { name?: string; goal?: string }) {
    if (!body?.name) {
      throw new BadRequestException("name e obrigatorio");
    }
    return this.projectsService.create({ name: body.name, goal: body.goal });
  }

  @Patch(":id/progress")
  updateProgress(@Param("id") id: string, @Body() body: { progress?: number }) {
    if (typeof body?.progress !== "number" || body.progress < 0 || body.progress > 100) {
      throw new BadRequestException("progress deve ser um numero entre 0 e 100");
    }
    return this.projectsService.updateProgress(id, body.progress);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { name?: string; goal?: string; progress?: number }) {
    if (body?.progress !== undefined && (body.progress < 0 || body.progress > 100)) {
      throw new BadRequestException("progress deve ser um numero entre 0 e 100");
    }
    return this.projectsService.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.projectsService.remove(id);
  }
}
