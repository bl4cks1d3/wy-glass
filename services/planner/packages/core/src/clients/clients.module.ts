import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { ClientsService } from "./clients.service";
import { ClientsController } from "./clients.controller";

@Module({
  imports: [EventsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
