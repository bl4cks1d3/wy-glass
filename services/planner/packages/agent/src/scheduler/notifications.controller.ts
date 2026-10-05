import { Controller, Get, Param, Post } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get("pending")
  listPending() {
    return this.notifications.listPending();
  }

  @Post(":id/ack")
  ack(@Param("id") id: string) {
    this.notifications.ack(id);
    return { ok: true };
  }
}
