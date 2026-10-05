import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { DataService } from "./data.service";
import { DataController } from "./data.controller";

@Module({
  imports: [EventsModule],
  controllers: [DataController],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
