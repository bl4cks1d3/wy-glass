import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { SubjectsService } from "./subjects.service";

@Controller("subjects")
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Get()
  list() {
    return this.subjectsService.list();
  }

  @Post()
  create(@Body() body: { name?: string; note?: string; examDate?: string }) {
    if (!body?.name) {
      throw new BadRequestException("name e obrigatorio");
    }
    return this.subjectsService.create({ name: body.name, note: body.note, examDate: body.examDate });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { progress?: number; note?: string; examDate?: string | null }) {
    if (body.progress !== undefined && (body.progress < 0 || body.progress > 100)) {
      throw new BadRequestException("progress deve ser um numero entre 0 e 100");
    }
    return this.subjectsService.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.subjectsService.remove(id);
  }
}
