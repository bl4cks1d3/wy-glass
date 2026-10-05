// Checks progressive tool discovery: a `brief` session enables `triage` mid-session.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const db = join(mkdtempSync(join(tmpdir(), 'mcb-roles-')), 'brain.db');
const p = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'apps/mcp/src/index.ts'], {
  env: { ...process.env, MCB_DB_PATH: db, MCB_ROLES: 'brief', MCB_AGENT: 'test-roles' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const waiters = new Map();
const notes = [];
let buf = '';
p.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (m.id != null) waiters.get(m.id)?.(m);
    else notes.push(m.method);
  }
});
let id = 0;
const call = (method, params) =>
  new Promise(
    (r) => (
      waiters.set(++id, r),
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    ),
  );

await call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 't', version: '1' },
});
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const before = (await call('tools/list')).result.tools.map((t) => t.name);
const blocked = await call('tools/call', { name: 'list_pending_content', arguments: {} });
const enabled = JSON.parse(
  (await call('tools/call', { name: 'enable_role', arguments: { roles: ['triage'] } })).result
    .content[0].text,
);
await new Promise((r) => setTimeout(r, 200));
const after = (await call('tools/list')).result.tools.map((t) => t.name);
const works = await call('tools/call', { name: 'list_pending_content', arguments: { limit: 1 } });

console.log('antes:', before.length, 'tools →', before.join(', '));
console.log(
  'list_pending_content antes de liberar:',
  blocked.error
    ? `erro (${blocked.error.message.slice(0, 60)})`
    : blocked.result?.isError
      ? 'bloqueada'
      : 'liberada?!',
);
console.log('enable_role(triage):', enabled.newTools.length, 'tools novas');
console.log('notificações:', [...new Set(notes)].join(', ') || 'nenhuma');
console.log('depois:', after.length, 'tools');
console.log(
  'list_pending_content depois:',
  works.result && !works.result.isError ? 'ok' : 'falhou',
);
p.kill();
process.exit(0);
