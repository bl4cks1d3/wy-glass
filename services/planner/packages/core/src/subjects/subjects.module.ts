import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { SubjectsService } from "./subjects.service";
import { SubjectsController } from "./subjects.controller";

@Module({
  imports: [EventsModule],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
