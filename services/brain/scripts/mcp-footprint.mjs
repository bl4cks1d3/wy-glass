// Measures what each subagent loads from the MCP server: tools and tools/list payload size.
// Usage: node scripts/mcp-footprint.mjs      (uses a throwaway DB, doesn't touch data/brain.db)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILES = {
  'antes (tudo, um agente)': 'all',
  'brain-collector': 'ingest,people',
  'brain-triage': 'triage',
  'brain-lesson': 'learn',
  'brain-planner': 'learn,build',
  'brain-briefer': 'brief',
  'brain-catchup': 'catchup',
  'brain-weekly': 'triage,learn,people,brief',
};

const db = join(mkdtempSync(join(tmpdir(), 'mcb-footprint-')), 'brain.db');

function measure(roles) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ['--no-warnings', '--import', 'tsx', 'apps/mcp/src/index.ts'],
      {
        env: { ...process.env, MCB_DB_PATH: db, MCB_ROLES: roles, MCB_AGENT: 'footprint' },
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n').slice(0, -1)) {
        const m = JSON.parse(line);
        if (m.id === 2) {
          p.kill();
          const tools = m.result.tools;
          resolve({ tools: tools.length, bytes: Buffer.byteLength(JSON.stringify(tools)) });
        }
      }
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    p.on('error', reject);
    const send = (m) => p.stdin.write(JSON.stringify(m) + '\n');
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'footprint', version: '1' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  });
}

const rows = [];
for (const [name, roles] of Object.entries(PROFILES)) {
  const r = await measure(roles);
  rows.push({
    perfil: name,
    papeis: roles,
    tools: r.tools,
    KB: +(r.bytes / 1024).toFixed(1),
    '~tokens': Math.round(r.bytes / 4),
  });
}
const base = rows[0]['~tokens'];
for (const r of rows)
  r['vs antes'] = r === rows[0] ? '—' : `-${Math.round((1 - r['~tokens'] / base) * 100)}%`;
console.table(rows);

// Saved for the /agent page (baseline vs scoped).
mkdirSync('data', { recursive: true });
writeFileSync(
  'data/footprint.json',
  JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2),
);
console.log('→ data/footprint.json');
