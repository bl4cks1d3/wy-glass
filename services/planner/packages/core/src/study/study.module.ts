import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { StudyService } from "./study.service";
import { StudyController } from "./study.controller";

@Module({
  imports: [EventsModule],
  controllers: [StudyController],
  providers: [StudyService],
  exports: [StudyService],
})
export class StudyModule {}
