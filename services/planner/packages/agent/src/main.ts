import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../.env') });
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Brain Office: a interface chega pelo proxy (mesma origem). CORS aberto deixaria
  // qualquer site no navegador ler os dados em localhost; so as origens do escritorio passam.
  const origins = (
    process.env.BRAIN_ALLOWED_ORIGINS ?? 'http://localhost:3456,http://127.0.0.1:3456'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins });
  const port = Number(process.env.AGENT_PORT ?? 4100);
  await app.listen(port, process.env.SERVICE_HOST ?? '127.0.0.1');
  console.log(`[planner-agent] rodando em http://localhost:${port}`);
}

bootstrap();
