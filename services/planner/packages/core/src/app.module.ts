import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { EventBusModule } from "./event-bus/event-bus.module";
import { EventsModule } from "./events/events.module";
import { ProjectsModule } from "./projects/projects.module";
import { TasksModule } from "./tasks/tasks.module";
import { MemoryModule } from "./memory/memory.module";
import { ClientsModule } from "./clients/clients.module";
import { SubjectsModule } from "./subjects/subjects.module";
import { ResearchModule } from "./research/research.module";
import { MessagesModule } from "./messages/messages.module";
import { HabitsModule } from "./habits/habits.module";
import { GoogleModule } from "./integrations/google/google.module";
import { P2pBridgeModule } from "./p2p-bridge/p2p-bridge.module";
import { VaultModule } from "./vault/vault.module";
import { StudyModule } from "./study/study.module";
import { SettingsModule } from "./settings/settings.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    DatabaseModule,
    EventBusModule,
    EventsModule,
    ProjectsModule,
    TasksModule,
    MemoryModule,
    ClientsModule,
    SubjectsModule,
    ResearchModule,
    MessagesModule,
    HabitsModule,
    GoogleModule,
    P2pBridgeModule,
    VaultModule,
    StudyModule,
    SettingsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
