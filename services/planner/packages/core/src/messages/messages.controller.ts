import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { MessagesService } from "./messages.service";

@Controller("messages")
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  list() {
    return this.messagesService.list();
  }

  @Post()
  create(
    @Body()
    body: { from?: string; subject?: string; snippet?: string; tag?: string; action?: string; receivedAt?: string }
  ) {
    if (!body?.from || !body?.subject) {
      throw new BadRequestException("from e subject sao obrigatorios");
    }
    return this.messagesService.upsert({
      from: body.from,
      subject: body.subject,
      snippet: body.snippet,
      tag: body.tag,
      action: body.action,
      receivedAt: body.receivedAt ?? new Date().toISOString(),
    });
  }

  @Patch(":id/handled")
  setHandled(@Param("id") id: string, @Body() body: { handled?: boolean }) {
    if (typeof body?.handled !== "boolean") {
      throw new BadRequestException("handled deve ser um booleano");
    }
    return this.messagesService.setHandled(id, body.handled);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    this.messagesService.remove(id);
    return { ok: true };
  }

  @Delete()
  clearAll() {
    return this.messagesService.clearAll();
  }
}
