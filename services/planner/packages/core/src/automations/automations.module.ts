import { Module } from '@nestjs/common';
import { DataModule } from '../data/data.module';
import { EventsModule } from '../events/events.module';
import { AgentClient } from './agent-client';
import { AutomationsController } from './automations.controller';
import { AutomationsRunner } from './automations.runner';
import { AutomationsService } from './automations.service';

@Module({
  imports: [EventsModule, DataModule],
  controllers: [AutomationsController],
  providers: [AgentClient, AutomationsService, AutomationsRunner],
  exports: [AutomationsService],
})
export class AutomationsModule {}
