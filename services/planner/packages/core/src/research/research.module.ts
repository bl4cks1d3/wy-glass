import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { VaultModule } from "../vault/vault.module";
import { ResearchService } from "./research.service";
import { ResearchController } from "./research.controller";

@Module({
  imports: [EventsModule, VaultModule],
  controllers: [ResearchController],
  providers: [ResearchService],
  exports: [ResearchService],
})
export class ResearchModule {}
