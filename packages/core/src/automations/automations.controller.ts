import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AutomationsService } from './automations.service';

type Body_ = Record<string, unknown>;

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  list() {
    return this.automations.list();
  }

  /** Tipos de no, eventos, ferramentas e colecoes: o que o editor e o MCP precisam para montar. */
  @Get('catalog')
  catalog() {
    return this.automations.catalog();
  }

  @Get('reminders')
  reminders() {
    return this.automations.listReminders();
  }

  @Post('reminders')
  createReminder(@Body() body: Body_) {
    return this.automations.createReminder(body ?? {});
  }

  @Get('runs/:runId')
  getRun(@Param('runId') runId: string) {
    return this.automations.getRun(runId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.automations.get(id);
  }

  @Post()
  create(@Body() body: Body_) {
    return this.automations.create(body ?? {});
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: Body_) {
    return this.automations.update(id, body ?? {});
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() body: { active?: unknown }) {
    if (typeof body?.active !== 'boolean')
      throw new BadRequestException('active deve ser true ou false');
    return this.automations.setActive(id, body.active);
  }

  @Post(':id/run')
  run(@Param('id') id: string, @Body() body: Body_) {
    return this.automations.run(id, body ?? {});
  }

  @Get(':id/runs')
  runs(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.automations.runs(id, Number(limit) || 20);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.automations.remove(id);
  }
}
