import { Controller, Get, Query } from "@nestjs/common";
import { EventsService } from "./events.service";

@Controller("events")
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.eventsService.list(limit ? Number(limit) : 50);
  }
}
