import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";

export interface VaultNoteMeta {
  path: string;
  title: string;
  updatedAt: string;
  excerpt?: string;
}

export interface VaultNote extends VaultNoteMeta {
  content: string;
}

/**
 * Obsidian nao e nada alem de arquivos .md numa pasta ("vault") -- entao
 * integrar com ele e so ler/escrever nessa mesma pasta direto do disco,
 * sem precisar de plugin nem API nenhuma. OBSIDIAN_VAULT_PATH aponta pro
 * vault de verdade do usuario; se nao configurado, usa uma pasta local
 * (data/vault) que funciona do mesmo jeito, so que sem o app Obsidian.
 */
@Injectable()
export class VaultService {
  private readonly root: string;

  constructor() {
    const configured = process.env.OBSIDIAN_VAULT_PATH?.trim();
    this.root = configured ? path.resolve(configured) : path.resolve(__dirname, "../../../../data/vault");
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Impede que um path relativo (ex: vindo do agente) escape do vault via "../../etc". */
  private resolveSafe(relPath: string): string {
    const normalized = relPath.replace(/^[/\\]+/, "");
    const target = path.resolve(this.root, normalized);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (target !== this.root && !target.startsWith(rootWithSep)) {
      throw new BadRequestException("caminho fora do vault");
    }
    return target;
  }

  private titleFromContent(content: string, fallback: string): string {
    const heading = content.match(/^#\s+(.+)$/m);
    return heading ? heading[1].trim() : fallback;
  }

  private walk(dir: string, base = ""): VaultNoteMeta[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const notes: VaultNoteMeta[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        notes.push(...this.walk(fullPath, relPath));
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, "utf8");
        const fallbackTitle = entry.name.replace(/\.md$/i, "");
        notes.push({
          path: relPath,
          title: this.titleFromContent(content, fallbackTitle),
          updatedAt: stat.mtime.toISOString(),
          excerpt: content.replace(/^#.*$/m, "").trim().slice(0, 160),
        });
      }
    }
    return notes;
  }

  list(): VaultNoteMeta[] {
    if (!fs.existsSync(this.root)) return [];
    return this.walk(this.root).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  read(relPath: string): VaultNote {
    const fullPath = this.resolveSafe(relPath);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`nota nao encontrada: ${relPath}`);
    }
    const content = fs.readFileSync(fullPath, "utf8");
    const stat = fs.statSync(fullPath);
    const fallbackTitle = path.basename(relPath).replace(/\.md$/i, "");
    return {
      path: relPath,
      title: this.titleFromContent(content, fallbackTitle),
      updatedAt: stat.mtime.toISOString(),
      content,
    };
  }

  write(relPath: string, content: string): VaultNoteMeta {
    const normalizedPath = relPath.toLowerCase().endsWith(".md") ? relPath : `${relPath}.md`;
    const fullPath = this.resolveSafe(normalizedPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    const stat = fs.statSync(fullPath);
    return {
      path: normalizedPath,
      title: this.titleFromContent(content, path.basename(normalizedPath).replace(/\.md$/i, "")),
      updatedAt: stat.mtime.toISOString(),
    };
  }

  remove(relPath: string): void {
    const fullPath = this.resolveSafe(relPath);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  /** Busca simples por titulo ou conteudo -- vault pessoal, nao precisa de indice. */
  search(query: string): VaultNoteMeta[] {
    const q = query.toLowerCase();
    return this.list().filter((n) => {
      if (n.title.toLowerCase().includes(q) || (n.excerpt ?? "").toLowerCase().includes(q)) return true;
      const fullPath = this.resolveSafe(n.path);
      return fs.readFileSync(fullPath, "utf8").toLowerCase().includes(q);
    });
  }
}
