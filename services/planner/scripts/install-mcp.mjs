#!/usr/bin/env node
// Registra o servidor MCP do Planner Life no Claude Code, com caminho ABSOLUTO,
// para as ferramentas (banco, blocos, automações...) funcionarem em
// qualquer pasta — não só com o Claude aberto na raiz do projeto (.mcp.json).
//
//   node scripts/install-mcp.mjs            registra (escopo "user")
//   node scripts/install-mcp.mjs --check    só mostra o estado
//   node scripts/install-mcp.mjs --remove   remove o registro
//   node scripts/install-mcp.mjs --scope local   só para este projeto (vale só no seu usuário)
//
// Por que não no projeto (--scope project)? O .mcp.json do repositório já faz isso
// com caminho relativo, e um caminho absoluto no arquivo versionado quebraria nas outras máquinas.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "planner-life";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "mcp", "dist", "index.js");
const isWin = process.platform === "win32";

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (has("--help") || has("-h")) {
  console.log(
    "Uso: node scripts/install-mcp.mjs [--check | --remove] [--scope user|local]\n" +
      "  (sem opções)  registra o MCP '" + NAME + "' no Claude Code (escopo user)\n" +
      "  --check       mostra se está registrado e conectado, sem alterar nada\n" +
      "  --remove      remove o registro\n" +
      "  --scope       user (padrão: vale em qualquer pasta) ou local (só neste projeto)"
  );
  process.exit(0);
}

const scope = valueOf("--scope") ?? "user";
if (scope === "project") {
  fail("O escopo 'project' já existe: é o .mcp.json da raiz (caminho relativo, vale com o Claude aberto nesta pasta). Use --scope user para valer em qualquer pasta.");
}
if (!["user", "local"].includes(scope)) fail(`Escopo inválido: ${scope} (use user ou local).`);

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}
const ok = (message) => console.log(`✔ ${message}`);
const info = (message) => console.log(`  ${message}`);

// Sem os marcadores de sessão do Claude Code (o script pode ser chamado de dentro de uma sessão).
const MARKERS = /^(CLAUDECODE|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|CLAUDE_CODE_(?!USE_).*)$/i;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !MARKERS.test(k)));

// ---------------------------------------------------------------- achar o Claude Code

function findClaude() {
  if (isWin) {
    // instalação do app: pega o claude.exe real mais recente (o "claude" do PATH pode ser um .cmd)
    const base = join(process.env.APPDATA ?? "", "Claude", "claude-code");
    try {
      const versions = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
      for (const v of versions) {
        const exe = join(base, v, "claude.exe");
        if (existsSync(exe)) return exe;
      }
    } catch {
      // segue para o PATH
    }
    const where = spawnSync("where", ["claude"], { encoding: "utf8", env: cleanEnv });
    const lines = (where.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.find((l) => l.toLowerCase().endsWith(".exe")) ?? lines[0] ?? null;
  }
  const which = spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8", env: cleanEnv });
  const found = (which.stdout ?? "").trim();
  if (found) return found;
  const home = process.env.HOME ?? "";
  return [join(home, ".claude", "local", "claude"), join(home, ".local", "bin", "claude")].find((p) => existsSync(p)) ?? null;
}

const claude = findClaude();
if (!claude) {
  fail(
    "Claude Code não encontrado. Instale em https://claude.com/claude-code e rode este script de novo.\n" +
      "  (Alternativa sem instalar nada: abrir o Claude Code na pasta do projeto — o .mcp.json já registra o MCP.)"
  );
}

/** Roda `claude ...`. Shims .cmd/.bat no Windows precisam de cmd; os argumentos aqui são fixos ou caminhos nossos. */
function runClaude(args, cwd = root) {
  const isShim = isWin && /\.(cmd|bat)$/i.test(claude);
  const result = isShim
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", `"${claude}" ${args.map((a) => `"${a}"`).join(" ")}`], { cwd, env: cleanEnv, encoding: "utf8", windowsVerbatimArguments: true })
    : spawnSync(claude, args, { cwd, env: cleanEnv, encoding: "utf8" });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

const version = runClaude(["--version"]);
if (version.code !== 0) fail(`O Claude Code encontrado (${claude}) não respondeu a --version:\n${version.out}`);
ok(`Claude Code ${version.out.split(/\s+/)[0]} (${claude})`);

// Escopo user: confere de OUTRA pasta — dentro do repositório o .mcp.json (projeto) tem prioridade e mascararia o resultado.
function currentLine() {
  const list = runClaude(["mcp", "list"], scope === "user" ? homedir() : root);
  return list.out.split(/\r?\n/).find((l) => l.startsWith(`${NAME}:`)) ?? null;
}

// ---------------------------------------------------------------- --check

if (has("--check")) {
  const line = currentLine();
  if (!line) {
    console.log(`✖ '${NAME}' não está registrado. Rode: node scripts/install-mcp.mjs`);
    process.exit(2);
  }
  console.log(`  ${line}`);
  process.exit(line.includes("Connected") ? 0 : 3);
}

// ---------------------------------------------------------------- --remove

if (has("--remove")) {
  const r = runClaude(["mcp", "remove", NAME, "-s", scope]);
  if (r.code === 0) ok(`'${NAME}' removido (escopo ${scope}).`);
  else info(r.out || "nada para remover.");
  process.exit(0);
}

// ---------------------------------------------------------------- instalar

if (!existsSync(dist)) {
  info("O servidor MCP ainda não foi compilado; compilando…");
  const build = spawnSync("pnpm", ["--filter", "@planner-life/shared", "--filter", "@planner-life/mcp", "build"], { cwd: root, stdio: "inherit", shell: isWin });
  if (build.status !== 0 || !existsSync(dist)) {
    fail("Não consegui compilar o MCP. Rode 'pnpm install' na raiz e tente de novo (ou use scripts/install.ps1 / install.sh).");
  }
}
ok(`Servidor MCP: ${dist}`);

// URLs só entram se você as definiu no ambiente (o padrão do servidor já é localhost:4000/4100)
const envArgs = ["PLANNER_CORE_URL", "PLANNER_AGENT_URL"]
  .filter((k) => process.env[k])
  .flatMap((k) => ["-e", `${k}=${process.env[k]}`]);

runClaude(["mcp", "remove", NAME, "-s", scope]); // idempotente: ignora se não existia
const add = runClaude(["mcp", "add", "-s", scope, NAME, ...envArgs, "--", process.execPath, dist]);
if (add.code !== 0) fail(`Falhou ao registrar o MCP:\n${add.out}`);
ok(`'${NAME}' registrado no Claude Code (escopo ${scope}, funciona em qualquer pasta).`);

const line = currentLine();
if (line) {
  console.log(`  ${line}`);
  if (!line.includes("Connected")) info("Não conectou agora: abra um novo terminal do Claude Code e confira com /mcp. Os serviços (pnpm dev) só precisam estar no ar para usar as ferramentas.");
}
console.log(
  "\nPronto. No Claude Code:\n" +
    "  • /mcp                       mostra o servidor e as ferramentas\n" +
    "  • /mcp__planner-life__construir-sistema      descreva sua situação e ele monta banco, blocos e painel\n" +
    "  • /mcp__planner-life__construir-automacao    descreva em português e ele monta a automação (no canvas do Planner)\n" +
    "Para desfazer: node scripts/install-mcp.mjs --remove"
);
