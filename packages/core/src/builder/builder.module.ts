import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { BuilderService } from './builder.service';
import { BuilderController } from './builder.controller';

@Module({
  imports: [EventsModule],
  controllers: [BuilderController],
  providers: [BuilderService],
  exports: [BuilderService],
})
export class BuilderModule {}
