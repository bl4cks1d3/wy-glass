// Prints the `tools:` line for a subagent from the MCP role map, so agent permissions and
// server roles never drift apart.  Usage: node scripts/gen-agent-tools.mjs triage,learn WebFetch
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../apps/mcp/src/roles.ts', import.meta.url), 'utf8');
const block = src.slice(
  src.indexOf('const ROLE_OF'),
  src.indexOf('};', src.indexOf('const ROLE_OF')),
);
const map = {};
for (const m of block.matchAll(/([a-z_]+):\s*\[([^\]]*)\]/g))
  map[m[1]] = m[2].replace(/["\s]/g, '').split(',');

export function toolsFor(roles, extra = []) {
  const everything = roles.includes('all');
  const set = new Set(['core', ...roles]);
  const names = Object.entries(map)
    .filter(([, r]) => everything || r.some((x) => set.has(x)))
    .map(([n]) => `mcp__current-brain__${n}`);
  return [
    ...names,
    ...(roles.includes('all') ? [] : ['mcp__current-brain__enable_role']),
    ...extra,
  ].join(', ');
}

if (process.argv[1]?.endsWith('gen-agent-tools.mjs')) {
  const [roles = 'core', ...extra] = process.argv.slice(2);
  console.log(toolsFor(roles.split(','), extra));
}
