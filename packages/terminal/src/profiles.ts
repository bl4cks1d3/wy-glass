import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "./env.js";

export const PROFILE_IDS = ["claude", "automacao", "agent", "shell"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface ProfileSpec {
  file: string;
  args: string[];
  cwd: string;
  title: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const IS_WIN = process.platform === "win32";
const COMSPEC = cleanEnv.ComSpec ?? cleanEnv.COMSPEC ?? "cmd.exe";

const AUTOMATION_PROMPT =
  "Modo automacao do Planner Life. O usuario descreve em portugues o que quer automatizar e ve a automacao (nos ligados por fios) aparecer no canvas ao lado. " +
  "Use as ferramentas MCP do servidor planner-life: chame planner_guide antes da primeira automacao, depois automation_nodes, list_automations e save_automation, e simule com run_automation. " +
  "Toda automacao fica como rascunho: peca ao usuario para clicar em Ativar no cabecalho da automacao. Nao ative nada e nao edite arquivos do projeto neste modo. " +
  "Responda sempre em portugues, de forma curta.";

export function isProfileId(value: unknown): value is ProfileId {
  return typeof value === "string" && (PROFILE_IDS as readonly string[]).includes(value);
}

// Mesma logica do ClaudeCodeService: no Windows o "claude" do PATH pode ser
// um shim .cmd, entao acha o claude.exe real da instalacao mais recente.
function findClaudeExe(): string | null {
  if (!IS_WIN) return null;
  const base = path.join(cleanEnv.APPDATA ?? "", "Claude", "claude-code");
  try {
    const versions = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const exe = path.join(base, version, "claude.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    // sem instalacao do app: cai no fallback abaixo
  }
  return null;
}

function claudeCwd(): string {
  return process.env.CLAUDE_CODE_CWD?.trim() || REPO_ROOT;
}

// O cliente so escolhe o NOME do perfil; comando, argumentos e pasta saem
// daqui. Nenhum texto vindo do navegador vira comando.
export function resolveProfile(id: ProfileId): ProfileSpec {
  switch (id) {
    case "claude": {
      const exe = findClaudeExe();
      if (exe) return { file: exe, args: [], cwd: claudeCwd(), title: "Claude Code" };
      if (IS_WIN) return { file: COMSPEC, args: ["/d", "/c", "claude"], cwd: claudeCwd(), title: "Claude Code" };
      return { file: "claude", args: [], cwd: claudeCwd(), title: "Claude Code" };
    }
    case "automacao": {
      // Claude Code ja orientado a montar automacoes (MCP planner-life) a partir do que o usuario disser.
      // Texto fixo e simples (sem aspas nem metacaracteres): vai como UM argumento.
      const args = ["--append-system-prompt", AUTOMATION_PROMPT];
      const exe = findClaudeExe();
      if (exe) return { file: exe, args, cwd: claudeCwd(), title: "Claude · Automação" };
      if (IS_WIN) return { file: COMSPEC, args: ["/d", "/c", "claude", ...args], cwd: claudeCwd(), title: "Claude · Automação" };
      return { file: "claude", args, cwd: claudeCwd(), title: "Claude · Automação" };
    }
    case "agent":
      if (IS_WIN) return { file: COMSPEC, args: ["/d", "/c", "pnpm cli"], cwd: REPO_ROOT, title: "Agente Planner" };
      return { file: "pnpm", args: ["cli"], cwd: REPO_ROOT, title: "Agente Planner" };
    case "shell":
      if (IS_WIN) return { file: "powershell.exe", args: ["-NoLogo"], cwd: REPO_ROOT, title: "Shell" };
      return { file: cleanEnv.SHELL || "bash", args: [], cwd: REPO_ROOT, title: "Shell" };
  }
}

export interface ClaudeStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

let claudeCache: { at: number; value: ClaudeStatus } | null = null;

// Roda "claude --version" (sem shell, argumentos fixos) para saber se o Claude
// Code esta instalado; guarda 60 s para a interface poder perguntar a vontade.
export function detectClaude(): Promise<ClaudeStatus> {
  if (claudeCache && Date.now() - claudeCache.at < 60_000) return Promise.resolve(claudeCache.value);
  const spec = resolveProfile("claude");
  return new Promise((resolvePromise) => {
    execFile(spec.file, [...spec.args, "--version"], { timeout: 8000, windowsHide: true, env: cleanEnv }, (err, stdout) => {
      const line = String(stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
      const value: ClaudeStatus =
        err || !line
          ? { installed: false }
          : { installed: true, version: line.split(/\s+/)[0], path: path.isAbsolute(spec.file) && spec.file.toLowerCase().endsWith("claude.exe") ? spec.file : undefined };
      claudeCache = { at: Date.now(), value };
      resolvePromise(value);
    });
  });
}
