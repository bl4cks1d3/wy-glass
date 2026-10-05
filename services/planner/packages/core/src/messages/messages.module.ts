import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { MessagesService } from "./messages.service";
import { MessagesController } from "./messages.controller";

@Module({
  imports: [EventsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
