import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { HabitsService } from "./habits.service";

@Controller("habits")
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  @Get()
  list() {
    return this.habitsService.list();
  }

  @Post()
  create(@Body() body: { name?: string; unit?: string; target?: number }) {
    if (!body?.name) {
      throw new BadRequestException("name e obrigatorio");
    }
    return this.habitsService.create(body as { name: string; unit?: string; target?: number });
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { current?: number; target?: number }) {
    return this.habitsService.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.habitsService.remove(id);
  }
}
