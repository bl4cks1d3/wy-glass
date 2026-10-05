import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Patch, Query, Redirect } from "@nestjs/common";
import { GoogleAuthService } from "./google-auth.service";
import { GmailService } from "./gmail.service";
import { CalendarService } from "./calendar.service";
import { GoogleTasksService } from "./google-tasks.service";
import { MessagesService } from "../../messages/messages.service";

@Controller("integrations/google")
export class GoogleController {
  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly gmailService: GmailService,
    private readonly calendarService: CalendarService,
    private readonly googleTasksService: GoogleTasksService,
    private readonly messagesService: MessagesService
  ) {}

  @Get("gmail/:id/body")
  async readMessageBody(@Param("id") id: string) {
    const message = this.messagesService.get(id);
    if (!message || !message.tag || !id.startsWith("gmail-")) {
      throw new NotFoundException("mensagem nao encontrada ou nao veio do Gmail");
    }
    const rawId = id.slice(`gmail-${message.tag}-`.length);
    return this.gmailService.getMessageBody(message.tag, rawId);
  }

  @Get("status")
  status() {
    const accounts = this.googleAuth.listAccounts();
    return { connected: accounts.length > 0, accounts };
  }

  @Get("auth")
  @Redirect()
  auth() {
    return { url: this.googleAuth.buildAuthUrl() };
  }

  @Get("callback")
  @Redirect()
  async callback(@Query("code") code?: string, @Query("error") error?: string) {
    const webAppUrl = process.env.WEB_APP_URL ?? "http://localhost:4300";
    if (error || !code) {
      return { url: `${webAppUrl}/?google=error` };
    }
    const email = await this.googleAuth.exchangeCode(code);
    await this.gmailService.syncInbox(10, email).catch(() => undefined);
    return { url: `${webAppUrl}/?google=connected&account=${encodeURIComponent(email)}` };
  }

  @Delete("accounts/:email")
  disconnect(@Param("email") email: string) {
    this.googleAuth.disconnect(decodeURIComponent(email));
    return { ok: true };
  }

  @Post("sync-gmail")
  sync(@Query("limit") limit?: string, @Query("account") account?: string) {
    return this.gmailService.syncInbox(limit ? Number(limit) : undefined, account);
  }

  @Get("calendar")
  calendar(@Query("limit") limit?: string) {
    return this.calendarService.listUpcoming(limit ? Number(limit) : undefined);
  }

  @Post("calendar/events")
  createEvent(
    @Body() body: { title?: string; start?: string; end?: string; description?: string; account?: string }
  ) {
    if (!body?.title || !body?.start || !body?.end) {
      throw new BadRequestException("title, start e end sao obrigatorios");
    }
    return this.calendarService.create({
      title: body.title,
      start: body.start,
      end: body.end,
      description: body.description,
      account: body.account,
    });
  }

  @Patch("calendar/events/:id")
  updateEvent(
    @Param("id") id: string,
    @Body() body: { title?: string; start?: string; end?: string; description?: string; account?: string }
  ) {
    return this.calendarService.update(id, body);
  }

  @Delete("calendar/events/:id")
  removeEvent(@Param("id") id: string, @Query("account") account?: string) {
    return this.calendarService.remove(id, account).then(() => ({ ok: true }));
  }

  @Get("tasks")
  listTasks(@Query("account") account?: string) {
    return this.googleTasksService.list(account);
  }

  @Post("tasks")
  createTask(@Body() body: { title?: string; notes?: string; due?: string; account?: string }) {
    if (!body?.title) {
      throw new BadRequestException("title e obrigatorio");
    }
    return this.googleTasksService.create({
      title: body.title,
      notes: body.notes,
      due: body.due,
      account: body.account,
    });
  }

  @Patch("tasks/:id")
  updateTask(
    @Param("id") id: string,
    @Body()
    body: { title?: string; notes?: string; due?: string; status?: "needsAction" | "completed"; account?: string }
  ) {
    return this.googleTasksService.update(id, body);
  }

  @Delete("tasks/:id")
  removeTask(@Param("id") id: string, @Query("account") account?: string) {
    return this.googleTasksService.remove(id, account).then(() => ({ ok: true }));
  }
}
