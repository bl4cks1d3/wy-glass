import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { StudyService } from "./study.service";

@Controller("study")
export class StudyController {
  constructor(private readonly studyService: StudyService) {}

  @Get("topics")
  listTopics(@Query("subjectId") subjectId?: string) {
    return this.studyService.listTopics(subjectId);
  }

  @Post("topics")
  createTopic(@Body() body: { subjectId?: string; title?: string; dueAt?: string }) {
    if (!body?.subjectId || !body?.title) {
      throw new BadRequestException("subjectId e title sao obrigatorios");
    }
    return this.studyService.createTopic({ subjectId: body.subjectId, title: body.title, dueAt: body.dueAt });
  }

  @Patch("topics/:id")
  setTopicDone(@Param("id") id: string, @Body() body: { done?: boolean }) {
    if (typeof body?.done !== "boolean") {
      throw new BadRequestException("done deve ser um booleano");
    }
    return this.studyService.setTopicDone(id, body.done);
  }

  @Delete("topics/:id")
  deleteTopic(@Param("id") id: string) {
    return this.studyService.deleteTopic(id);
  }

  @Get("schedule")
  listSchedule() {
    return this.studyService.listSchedule();
  }

  @Post("schedule")
  createScheduleBlock(
    @Body() body: { subjectId?: string; dayOfWeek?: number; startTime?: string; endTime?: string }
  ) {
    if (!body?.subjectId || body.dayOfWeek === undefined || !body?.startTime || !body?.endTime) {
      throw new BadRequestException("subjectId, dayOfWeek, startTime e endTime sao obrigatorios");
    }
    if (body.dayOfWeek < 0 || body.dayOfWeek > 6) {
      throw new BadRequestException("dayOfWeek deve ser entre 0 (domingo) e 6 (sabado)");
    }
    return this.studyService.createScheduleBlock({
      subjectId: body.subjectId,
      dayOfWeek: body.dayOfWeek,
      startTime: body.startTime,
      endTime: body.endTime,
    });
  }

  @Delete("schedule/:id")
  deleteScheduleBlock(@Param("id") id: string) {
    return this.studyService.deleteScheduleBlock(id);
  }

  @Get("sessions")
  listSessions(@Query("days") days?: string) {
    return this.studyService.listSessions(days ? Number(days) : undefined);
  }

  @Post("sessions")
  createSession(
    @Body() body: { subjectId?: string; durationMinutes?: number; startedAt?: string; endedAt?: string }
  ) {
    if (!body?.durationMinutes || !body?.startedAt || !body?.endedAt) {
      throw new BadRequestException("durationMinutes, startedAt e endedAt sao obrigatorios");
    }
    return this.studyService.createSession({
      subjectId: body.subjectId,
      durationMinutes: body.durationMinutes,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
    });
  }

  @Delete("sessions/:id")
  deleteSession(@Param("id") id: string) {
    return this.studyService.deleteSession(id);
  }
}
