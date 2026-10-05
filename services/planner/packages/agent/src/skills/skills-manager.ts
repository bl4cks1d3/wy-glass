import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentTool } from "../tools";

// packages/agent/src/skills -> packages/agent/skills
const SKILLS_DIR = resolve(__dirname, "../../skills");

interface Skill {
  name: string;
  description: string;
  body: string;
}

function parseSkillFile(raw: string): { name?: string; description?: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: raw.trim() };

  const [, frontmatter, body] = match;
  const meta: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { name: meta.name, description: meta.description, body: body.trim() };
}

/**
 * Skills sao pacotes de instrucoes carregados sob demanda -- o mesmo
 * mecanismo que o Claude Code usa consigo mesmo: o catalogo (nome +
 * descricao) fica sempre visivel pro modelo, e o conteudo completo so e
 * carregado quando a ferramenta use_skill e chamada, pra nao gastar
 * contexto com instrucoes que nao vao ser usadas naquela conversa.
 */
@Injectable()
export class SkillsManager {
  private readonly logger = new Logger(SkillsManager.name);
  private readonly skills = new Map<string, Skill>();

  constructor() {
    this.load();
  }

  private load(): void {
    if (!existsSync(SKILLS_DIR)) return;

    for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(SKILLS_DIR, entry.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      const { name, description, body } = parseSkillFile(readFileSync(skillFile, "utf8"));
      const skillName = name ?? entry.name;
      this.skills.set(skillName, {
        name: skillName,
        description: description ?? "(sem descricao)",
        body,
      });
    }

    if (this.skills.size > 0) {
      this.logger.log(`skills carregadas: ${[...this.skills.keys()].join(", ")}`);
    }
  }

  describeAvailable(): string {
    if (this.skills.size === 0) return "";
    const lines = [...this.skills.values()].map((skill) => `- ${skill.name}: ${skill.description}`);
    return `Skills disponiveis (use a ferramenta use_skill para carregar as instrucoes completas de uma delas quando o pedido do usuario combinar com alguma):\n${lines.join(
      "\n"
    )}`;
  }

  listTools(): AgentTool[] {
    if (this.skills.size === 0) return [];
    return [
      {
        name: "use_skill",
        description:
          "Carrega as instrucoes completas de uma skill do Planner Life pelo nome, para seguir um processo especifico ja definido.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", enum: [...this.skills.keys()] },
          },
          required: ["name"],
        },
      },
    ];
  }

  getContent(name: string): string {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(
        `skill desconhecida: "${name}". Skills disponiveis: ${[...this.skills.keys()].join(", ") || "nenhuma"}`
      );
    }
    return skill.body;
  }
}
