import { Global, Module } from "@nestjs/common";
import { PlannerEventBus } from "../eventBus";

@Global()
@Module({
  providers: [PlannerEventBus],
  exports: [PlannerEventBus],
})
export class EventBusModule {}
