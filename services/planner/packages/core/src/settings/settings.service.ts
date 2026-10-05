import { Injectable, Logger } from "@nestjs/common";
import { parse } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

const ENV_PATH = path.resolve(__dirname, "../../../../.env");

/** Chaves que guardam segredo -- nunca voltam pro navegador em texto puro,
 * so um indicador de que estao preenchidas. Mandar API key de volta pra
 * tela toda vez que alguem abre Configuracoes e exposicao desnecessaria. */
const SECRET_KEYS = new Set(["GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"]);

export interface SettingField {
  key: string;
  value: string | null;
  isSecret: boolean;
  hasValue: boolean;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  private readAll(): Record<string, string> {
    if (!fs.existsSync(ENV_PATH)) return {};
    return parse(fs.readFileSync(ENV_PATH, "utf8"));
  }

  /** So devolve as chaves que a tela de Configuracoes sabe editar --
   * o resto do .env (portas, URLs internas) fica de fora de proposito. */
  getAll(keys: string[]): SettingField[] {
    const env = this.readAll();
    return keys.map((key) => {
      const raw = env[key]?.trim() || "";
      const isSecret = SECRET_KEYS.has(key);
      return {
        key,
        value: isSecret ? null : raw || null,
        isSecret,
        hasValue: raw.length > 0,
      };
    });
  }

  /** Atualiza so as linhas KEY=valor que ja existem (ou adiciona no fim se
   * faltar), preservando comentarios e o resto do arquivo intactos. Vazio
   * ("") apaga a chave: `env[KEY]=` no arquivo. */
  update(updates: Record<string, string>): void {
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    for (const [key, value] of Object.entries(updates)) {
      const escaped = value.replace(/\r?\n/g, " ").trim();
      const line = `${key}=${escaped}`;
      const pattern = new RegExp(`^${key}=.*$`, "m");
      if (pattern.test(content)) {
        content = content.replace(pattern, line);
      } else {
        content = content.trimEnd() + `\n${line}\n`;
      }
    }
    fs.writeFileSync(ENV_PATH, content, "utf8");
    this.logger.log(`configuracoes atualizadas: ${Object.keys(updates).join(", ")} -- reinicie os servicos afetados`);
  }
}
