import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ClientsService } from "./clients.service";
import type { ClientStage } from "@planner-life/shared";

const VALID_STAGES: ClientStage[] = ["lead", "contact", "proposal", "closed"];

@Controller("clients")
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list() {
    return this.clientsService.list();
  }

  @Post()
  create(
    @Body()
    body: { name?: string; stage?: string; value?: number; nextAction?: string; nextActionAt?: string }
  ) {
    if (!body?.name) {
      throw new BadRequestException("name e obrigatorio");
    }
    if (body.stage && !VALID_STAGES.includes(body.stage as ClientStage)) {
      throw new BadRequestException("stage invalido");
    }
    return this.clientsService.create({
      name: body.name,
      stage: body.stage as ClientStage | undefined,
      value: body.value,
      nextAction: body.nextAction,
      nextActionAt: body.nextActionAt,
    });
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: { stage?: string; value?: number; nextAction?: string; nextActionAt?: string }
  ) {
    if (body.stage && !VALID_STAGES.includes(body.stage as ClientStage)) {
      throw new BadRequestException("stage invalido");
    }
    return this.clientsService.update(id, {
      stage: body.stage as ClientStage | undefined,
      value: body.value,
      nextAction: body.nextAction,
      nextActionAt: body.nextActionAt,
    });
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.clientsService.remove(id);
  }
}
