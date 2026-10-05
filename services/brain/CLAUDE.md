# My Current Brain — notes for Claude Code

- Part of the Brain Office monorepo (`../..`): `packages/core` (SQLite via `node:sqlite`, repository, ingestion, link discovery, backfill, graphs), `apps/mcp` (MCP server `current-brain`, stdio), `apps/terminal` (worker: PTY running `claude`, 10-min collector, and the `/rpc/<fn>` API the office calls). There is no web app here anymore: the UI is the Brain Office tab "Pesquisa & Tec" (`webview-ui/src/brain/pages/PesquisaPage.tsx`, `BrainTools.tsx`).
- The Brain Office server starts the worker (`server/src/brain/services.ts`) and proxies `/svc/brain/rpc/<fn>` to it with a private token. New UI actions: add the core function to the RPC list in `apps/terminal/src/api.ts`.
- The product never calls an LLM API. AI work is done by the `brain-curator` agents (`.claude/agents/`) through the MCP tools, on the user's Claude subscription. Don't add LLM SDK calls; add an MCP tool instead.
- Specs: `docs/PTD.md`, `docs/PTR.md`, `docs/DESIGN-BRIEF.md`.
- UI copy is pt-BR. Section names stay in English (Now, Learn, Build, Build Watch, Frontier).
- Keep the three content layers separate: `excerpt` (source fact, never rewritten), `summary`/`whyItMatters` (AI), user state/feedback.
- DB path: `MCB_DB_PATH` or `<brain office>/data/brain/brain.db`.
- Checks: from the monorepo root, `npx tsc --noEmit -p services/brain/packages/core` and the office build (`npm run build:all`).

## Agent architecture

- Subagents in `.claude/agents/`: `brain-collector` → `brain-triage` → `brain-lesson` → `brain-planner` → `brain-briefer` (daily, in that order), plus `brain-weekly`, `brain-catchup` and the generalist `brain-curator`.
- Each agent declares `roles:` (and `extra-tools:`) in its frontmatter; `node scripts/sync-agents.mjs` regenerates the `tools:` line from the role map in `apps/mcp/src/roles.ts`. Add new MCP tools to `ROLE_OF` there, then re-sync.
- The MCP server exposes only the roles in `MCB_ROLES` (default all); `enable_role` turns more on mid-session (tools/list_changed). Every call is logged to `tool_calls` (see /agent).
- `.claude/skills/brain-triage` is the single triage procedure. `.claude/hooks/validate-brain.mjs` (PreToolUse, `.claude/settings.json`) blocks weak writes; test with `node scripts/test-hooks.mjs`.
- Headless: `scripts/run-agent.ps1 -Task daily|weekly|catchup|lesson|plan` (`-DryRun` to inspect, `-Legacy` for the single-agent baseline). Measure context with `node scripts/mcp-footprint.mjs`.
- Windows gotchas: Python writes CRLF in text mode (use Node or `newline="\n"`); `.ps1` files need a UTF-8 BOM for PowerShell 5.1; keep CLI prompt args ASCII (`claude.cmd` goes through cmd.exe).
