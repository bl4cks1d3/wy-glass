// Regenerates the `tools:` line of every .claude/agents/*.md from its `roles:` / `extra-tools:`
// frontmatter, using the MCP role map (apps/mcp/src/roles.ts). Run after changing roles.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolsFor } from './gen-agent-tools.mjs';

const dir = new URL('../.claude/agents/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const path = join(dir, f);
  const src = readFileSync(path, 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const roles = fm?.match(/^roles:\s*(.+)$/m)?.[1]?.trim();
  if (!roles) continue;
  const extra = (fm.match(/^extra-tools:\s*(.+)$/m)?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tools = toolsFor(
    roles.split(',').map((r) => r.trim()),
    extra,
  );
  writeFileSync(path, src.replace(/^tools:.*$/m, `tools: ${tools}`));
  console.log(`${f.padEnd(22)} ${roles.padEnd(28)} ${tools.split(', ').length} tools`);
}
