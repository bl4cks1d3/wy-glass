import { Module } from "@nestjs/common";
import { MessagesModule } from "../../messages/messages.module";
import { GoogleAuthService } from "./google-auth.service";
import { GmailService } from "./gmail.service";
import { CalendarService } from "./calendar.service";
import { GoogleTasksService } from "./google-tasks.service";
import { GoogleController } from "./google.controller";

@Module({
  imports: [MessagesModule],
  controllers: [GoogleController],
  providers: [GoogleAuthService, GmailService, CalendarService, GoogleTasksService],
  exports: [GoogleAuthService],
})
export class GoogleModule {}
