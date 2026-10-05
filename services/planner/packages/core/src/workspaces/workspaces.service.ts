import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Workspace, WorkspaceNode, WorkspaceNodeType, WorkspaceViewport } from "@planner-life/shared";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";

const MAX_NODES = 200;
const NODE_TYPES: WorkspaceNodeType[] = ["terminal", "block", "note", "automation"];
const PROFILES = ["claude", "automacao", "agent", "shell"];

interface Row {
  id: string;
  name: string;
  nodes: string;
  viewport: string;
  created_at: string;
  updated_at: string;
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function toWorkspace(row: Row): Workspace {
  return {
    id: row.id,
    name: row.name,
    nodes: JSON.parse(row.nodes) as WorkspaceNode[],
    viewport: JSON.parse(row.viewport) as WorkspaceViewport,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Workspace = canvas persistente (estilo Maestri) onde ficam terminais, blocos do
 * Construtor e notas. So o layout mora aqui: as sessoes de terminal vivem no
 * servico `terminal` e o codigo dos blocos no Construtor.
 */
@Injectable()
export class WorkspacesService implements OnModuleInit {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  /** Primeira execucao: um workspace "Inicio" ja com blocos embutidos e uma nota de boas-vindas. */
  onModuleInit(): void {
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number };
    if (count.n > 0) return;
    const node = (id: string, type: WorkspaceNodeType, x: number, y: number, w: number, h: number, data: Record<string, unknown>, z: number): WorkspaceNode => ({ id, type, x, y, w, h, z, data });
    this.insert({
      name: "Início",
      viewport: { x: 60, y: 60, zoom: 1 },
      nodes: [
        node("n-resumo", "block", 0, 0, 640, 190, { blockId: "builtin-resumo" }, 1),
        node("n-relogio", "block", 660, 0, 260, 190, { blockId: "builtin-relogio" }, 2),
        node("n-tarefas", "block", 0, 210, 420, 430, { blockId: "builtin-tarefas" }, 3),
        node("n-agenda", "block", 440, 210, 340, 430, { blockId: "builtin-agenda" }, 4),
        node(
          "n-nota",
          "note",
          800,
          210,
          300,
          240,
          {
            text:
              "Bem-vindo ao seu canvas.\n\n• Arraste os títulos para mover, o canto para redimensionar.\n• Ctrl + roda do mouse dá zoom; arraste o fundo para navegar.\n• Na barra do topo: terminal (Claude Code), blocos do Construtor e notas.\n\nOs terminais continuam rodando ao trocar de workspace.",
          },
          5
        ),
      ],
    });
    this.logger.log("workspace inicial criado");
  }

  list(): Workspace[] {
    const rows = this.db.prepare(`SELECT * FROM workspaces ORDER BY created_at ASC`).all() as unknown as Row[];
    return rows.map(toWorkspace);
  }

  get(id: string): Workspace {
    const row = this.db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as Row | undefined;
    if (!row) throw new NotFoundException("workspace nao encontrado");
    return toWorkspace(row);
  }

  create(input: Record<string, unknown>): Workspace {
    const ws = this.insert({
      name: this.name(input.name),
      nodes: this.nodes(input.nodes),
      viewport: this.viewport(input.viewport),
    });
    this.emit("workspace.created", { workspaceId: ws.id, name: ws.name });
    return ws;
  }

  update(id: string, input: Record<string, unknown>): Workspace {
    const current = this.get(id);
    // outra janela gravou depois: recusa em vez de sobrescrever o layout dela com estado velho
    if (typeof input.baseUpdatedAt === "string" && input.baseUpdatedAt !== current.updatedAt) {
      throw new ConflictException("workspace alterado em outra janela; recarregue");
    }
    const next: Workspace = {
      ...current,
      name: input.name !== undefined ? this.name(input.name) : current.name,
      nodes: input.nodes !== undefined ? this.nodes(input.nodes) : current.nodes,
      viewport: input.viewport !== undefined ? this.viewport(input.viewport) : current.viewport,
      // updatedAt e a versao do layout: renomear nao invalida canvases abertos
      updatedAt: input.nodes !== undefined || input.viewport !== undefined ? new Date().toISOString() : current.updatedAt,
    };
    this.db
      .prepare(`UPDATE workspaces SET name = ?, nodes = ?, viewport = ?, updated_at = ? WHERE id = ?`)
      .run(next.name, JSON.stringify(next.nodes), JSON.stringify(next.viewport), next.updatedAt, id);
    // layout salva a cada pan/arraste: so o nome vira evento
    if (next.name !== current.name) this.emit("workspace.updated", { workspaceId: id, name: next.name });
    return next;
  }

  remove(id: string) {
    this.get(id);
    this.db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
    this.emit("workspace.deleted", { workspaceId: id });
    return { ok: true };
  }

  // ---------------------------------------------------------------- interno

  private insert(input: { name: string; nodes: WorkspaceNode[]; viewport: WorkspaceViewport }): Workspace {
    const now = new Date().toISOString();
    const ws: Workspace = { id: randomUUID(), name: input.name, nodes: input.nodes, viewport: input.viewport, createdAt: now, updatedAt: now };
    this.db
      .prepare(`INSERT INTO workspaces (id, name, nodes, viewport, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(ws.id, ws.name, JSON.stringify(ws.nodes), JSON.stringify(ws.viewport), now, now);
    return ws;
  }

  private name(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new BadRequestException("name e obrigatorio");
    if (value.length > 60) throw new BadRequestException("name passa do limite de 60 caracteres");
    return value.trim();
  }

  private viewport(value: unknown): WorkspaceViewport {
    const v = (value ?? {}) as Record<string, unknown>;
    return { x: clampNum(v.x, -1_000_000, 1_000_000, 0), y: clampNum(v.y, -1_000_000, 1_000_000, 0), zoom: clampNum(v.zoom, 0.2, 2.5, 1) };
  }

  private nodes(value: unknown): WorkspaceNode[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException("nodes deve ser uma lista");
    if (value.length > MAX_NODES) throw new BadRequestException(`no maximo ${MAX_NODES} itens por workspace`);
    return value.map((raw) => {
      const n = (raw ?? {}) as Record<string, unknown>;
      const type = n.type as WorkspaceNodeType;
      if (!NODE_TYPES.includes(type)) throw new BadRequestException(`tipo de item invalido: ${String(n.type)}`);
      const d = (n.data ?? {}) as Record<string, unknown>;
      let data: Record<string, unknown> = {};
      if (type === "terminal") {
        const profile = PROFILES.includes(String(d.profile)) ? String(d.profile) : "shell";
        data = { sessionId: str(d.sessionId, 80), profile, title: str(d.title, 80) || undefined };
      } else if (type === "block") {
        data = { blockId: str(d.blockId, 80) };
      } else if (type === "automation") {
        // editor de automacao; sem automationId mostra a escolha (ou espera o Claude criar uma)
        data = { automationId: str(d.automationId, 80) || undefined, title: str(d.title, 80) || undefined };
      } else {
        data = { text: str(d.text, 20_000) };
      }
      return {
        id: typeof n.id === "string" && n.id && n.id.length <= 80 ? n.id : randomUUID(),
        type,
        x: clampNum(n.x, -200_000, 200_000, 0),
        y: clampNum(n.y, -200_000, 200_000, 0),
        w: clampNum(n.w, 160, 6000, 480),
        h: clampNum(n.h, 100, 6000, 320),
        z: Math.round(clampNum(n.z, 0, 1_000_000, 1)),
        data,
      };
    });
  }

  private emit(type: "workspace.created" | "workspace.updated" | "workspace.deleted", payload: Record<string, unknown>) {
    this.eventsService.record(type, payload);
    this.eventBus.publish(type, payload);
  }
}
