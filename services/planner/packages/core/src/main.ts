import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(__dirname, "../../../.env") });
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.CORE_PORT ?? 4000);
  await app.listen(port);
  console.log(`[planner-core] rodando em http://localhost:${port}`);
}

bootstrap();
