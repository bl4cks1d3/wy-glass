import { Global, Module } from "@nestjs/common";
import { openDatabase } from "../db";

export const PLANNER_DB = "PLANNER_DB";

@Global()
@Module({
  providers: [
    {
      provide: PLANNER_DB,
      useFactory: () => openDatabase(process.env.DB_PATH ?? "./data/planner.db"),
    },
  ],
  exports: [PLANNER_DB],
})
export class DatabaseModule {}
