import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Snapshot ANTES de carregar o .env do projeto: os terminais herdam so o
// ambiente real do usuario, nunca as chaves de API que estao no .env (quem
// precisa delas, como o `pnpm cli`, carrega o .env por conta propria).
//
// Tambem remove os marcadores de sessao do Claude Code (CLAUDECODE,
// CLAUDE_CODE_*, tokens de mensagens...): se o servico foi iniciado de dentro
// de outra sessao, o Claude embutido se acharia uma sessao "filha" (sem
// gravar transcricao) e o shell herdaria credenciais que nao sao dele. So
// CLAUDE_CODE_USE_* (escolha de provedor) e mantida, e configuracao do usuario.
const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_AGENT_SDK_.*|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.*|CLAUDE_CODE_(?!USE_).*)$/i;

export const cleanEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && !SESSION_MARKERS.test(entry[0])
  )
);

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
