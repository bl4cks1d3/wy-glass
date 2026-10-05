import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { MemoryService } from "./memory.service";
import { MemoryController } from "./memory.controller";

@Module({
  imports: [EventsModule],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
