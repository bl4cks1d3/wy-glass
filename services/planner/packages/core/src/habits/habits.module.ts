import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { HabitsService } from "./habits.service";
import { HabitsController } from "./habits.controller";

@Module({
  imports: [EventsModule],
  controllers: [HabitsController],
  providers: [HabitsService],
  exports: [HabitsService],
})
export class HabitsModule {}
