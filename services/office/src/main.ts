/**
 * Serviço do escritório: agentes residentes (life/), API /api/brain e o supervisor dos serviços
 * (Planner, Current Brain, e o próprio Wy Glass quando BRAIN_SVC_WYGLASS=true). Sem interface
 * própria -- quem mostra o escritório é a Central do orb, via proxy /api/office do server.py.
 *
 *   node --import tsx services/office/src/main.ts [--port 3456] [--host 127.0.0.1]
 */
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import { BrainService } from './brainService.js';
import { AgentRuntime, AgentStateStore } from './pixelShim.js';
import { registerBrainRoutes } from './routes.js';
import { loadOfficeEnv, ServiceSupervisor } from './services.js';
import { registerServiceRoutes } from './svcRoutes.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// services/office/src -> raiz do repo
const repoDir = path.resolve(__dirname, '..', '..', '..');
const port = Number(arg('--port', process.env.OFFICE_PORT ?? '3456'));
const host = arg('--host', '127.0.0.1');

async function main(): Promise<void> {
  loadOfficeEnv(repoDir);
  const supervisor = new ServiceSupervisor(repoDir);
  const brainDataDir = path.dirname(
    process.env.MCB_DB_PATH ?? path.join(repoDir, 'data', 'brain', 'brain.db'),
  );
  const brainLifeDir = process.env.BRAIN_LIFE_DIR ?? path.join(repoDir, 'life');
  if (!fs.existsSync(brainLifeDir)) throw new Error(`pasta dos setores ausente: ${brainLifeDir}`);

  const brain = new BrainService({
    brainLifeDir,
    officeRepoDir: repoDir,
    store: new AgentStateStore(),
    runtime: new AgentRuntime(),
  });
  const token = brain.persistence.loadOrCreateToken();

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  app.get('/api/health', async () => ({ ok: true, service: 'office' }));
  registerBrainRoutes(app, brain, token);
  registerServiceRoutes(app, supervisor, token, brainDataDir);
  await app.listen({ port, host });

  // Os serviços aceitam chamadas de navegador só da origem do escritório e do orb.
  const origins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://127.0.0.1:8731',
    'http://localhost:8731',
  ].join(',');
  for (const k of [
    'BRAIN_ALLOWED_ORIGINS',
    'TOOLS_ALLOWED_ORIGINS',
    'TERMINAL_ALLOWED_ORIGINS',
    'VOICE_ALLOWED_ORIGINS',
    'MCB_WEB_ORIGIN',
  ]) {
    process.env[k] = origins;
  }
  supervisor.startAll();
  brain.start();
  console.log(`  Escritório (office) em http://${host}:${port}/api/brain`);

  const shutdown = () => {
    brain.dispose();
    supervisor.dispose();
    void app.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
