import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type ClaudeCodeActionStatus = "pending" | "running" | "done" | "error" | "rejected";

export interface ClaudeCodeAction {
  id: string;
  prompt: string;
  cwd: string;
  status: ClaudeCodeActionStatus;
  createdAt: string;
  output?: string;
  error?: string;
  /** "research": ao confirmar, salva o output como nota + artigo em Pesquisa
   * automaticamente, em vez de so mostrar o texto bruto no card. */
  kind?: "research";
  meta?: { theme?: string };
}

const CORE_API_URL = process.env.CORE_API_URL ?? "http://localhost:4000";

/**
 * No Windows, "claude" e um shim .cmd que so acha a versao mais recente e
 * chama o .exe de verdade -- execFile sem shell:true da "spawn EINVAL" em
 * arquivos .cmd (o Windows so consegue rodar .cmd via cmd.exe). Usar
 * shell:true resolveria isso, mas o Node avisa explicitamente (DEP0190)
 * que os argumentos NAO sao escapados nesse modo -- so concatenados --
 * entao um prompt com aspas/&/| viraria injecao de comando de verdade.
 * A saida sem shell nenhum: replicar a mesma logica do shim (achar o .exe
 * na pasta de instalacao mais recente) e chamar ELE direto, sem shell.
 */
function resolveClaudeBin(): string {
  if (process.platform !== "win32") return "claude";
  const base = path.join(process.env.APPDATA ?? "", "Claude", "claude-code");
  try {
    const versions = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const exePath = path.join(base, version, "claude.exe");
      if (fs.existsSync(exePath)) return exePath;
    }
  } catch {
    // cai pro fallback abaixo (vai falhar com uma mensagem clara se nao existir)
  }
  return "claude.exe";
}

/**
 * O Personal Agent nunca executa run_claude_code sozinho: ele so registra um
 * pedido pendente aqui. O dashboard mostra esse pedido e o usuario precisa
 * clicar em "confirmar" para o comando de verdade rodar no terminal --
 * dar a um agente autonomo (inclusive por comando de voz) permissao pra
 * chamar outro agente de codigo com acesso total ao sistema sem essa
 * confirmacao e um padrao perigoso demais pra liberar sem humano no meio.
 */
@Injectable()
export class ClaudeCodeService {
  private readonly logger = new Logger(ClaudeCodeService.name);
  private readonly actions = new Map<string, ClaudeCodeAction>();

  createPending(
    prompt: string,
    cwd?: string,
    kind?: ClaudeCodeAction["kind"],
    meta?: ClaudeCodeAction["meta"]
  ): ClaudeCodeAction {
    const id = randomUUID();
    const action: ClaudeCodeAction = {
      id,
      prompt,
      cwd: cwd?.trim() || process.env.CLAUDE_CODE_CWD || process.cwd(),
      status: "pending",
      createdAt: new Date().toISOString(),
      kind,
      meta,
    };
    this.actions.set(id, action);
    return action;
  }

  /** Pedido de pesquisa: cwd fixo (nao mexe no repo do usuario), prompt
   * pede pra devolver so o markdown, sem comentario nenhum antes/depois. */
  createResearchRequest(theme: string): ClaudeCodeAction {
    const prompt =
      `Pesquise sobre o tema a seguir e escreva um resumo completo, bem estruturado e ` +
      `preciso em markdown (comece com "# ${theme}", use secoes com "##"). Devolva ` +
      `SOMENTE o conteudo em markdown como resposta final -- sem nenhum comentario, ` +
      `saudacao ou explicacao antes ou depois do markdown.\n\nTema: ${theme}`;
    return this.createPending(prompt, undefined, "research", { theme });
  }

  /** Terminal direto: o usuario escreveu e enviou o prompt ele mesmo, entao
   * isso ja E a confirmacao humana -- roda na hora, sem passar pela fila de
   * pendentes (essa fila existe pra quando quem decide chamar o Claude Code
   * e o agente autonomo, nao a pessoa). */
  async runNow(prompt: string, cwd?: string): Promise<ClaudeCodeAction> {
    const action = this.createPending(prompt, cwd);
    return this.confirm(action.id);
  }

  listPending(): ClaudeCodeAction[] {
    return [...this.actions.values()]
      .filter((a) => a.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  reject(id: string): ClaudeCodeAction {
    const action = this.mustGet(id);
    action.status = "rejected";
    return action;
  }

  async confirm(id: string): Promise<ClaudeCodeAction> {
    const action = this.mustGet(id);
    action.status = "running";
    try {
      action.output = await this.run(action.prompt, action.cwd);
      action.status = "done";
      if (action.kind === "research") {
        await this.saveAsResearchNote(action);
      }
    } catch (err) {
      action.error = err instanceof Error ? err.message : String(err);
      action.status = "error";
      this.logger.error(action.error);
    }
    return action;
  }

  private async saveAsResearchNote(action: ClaudeCodeAction): Promise<void> {
    const theme = action.meta?.theme ?? "Pesquisa";
    const content = action.output?.trim();
    if (!content) return;
    const slug = theme
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const notePath = `Pesquisas/${slug || "pesquisa"}-${Date.now()}.md`;
    try {
      await fetch(`${CORE_API_URL}/vault/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: notePath, content }),
      });
      await fetch(`${CORE_API_URL}/research/papers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: theme, status: "resumido", notePath }),
      });
    } catch (err) {
      this.logger.error(`falha ao salvar pesquisa "${theme}" como nota: ${err instanceof Error ? err.message : err}`);
    }
  }

  private mustGet(id: string): ClaudeCodeAction {
    const action = this.actions.get(id);
    if (!action) throw new NotFoundException(`pedido ${id} nao encontrado`);
    return action;
  }

  private run(prompt: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        resolveClaudeBin(),
        ["-p", prompt],
        { cwd, timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr.trim() || err.message));
            return;
          }
          resolve(stdout.trim() || stderr.trim());
        }
      );
    });
  }
}
