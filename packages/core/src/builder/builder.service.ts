import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Block,
  BlockPermissions,
  Dashboard,
  DashboardItem,
  DashboardMode,
  Rect,
} from '@planner-life/shared';
import type { PlannerDb } from '../db';
import { PLANNER_DB } from '../database/database.module';
import { PlannerEventBus } from '../eventBus';
import { EventsService } from '../events/events.service';
import * as repo from '../repositories/builder';
import { BASIC_DASHBOARD, SEED_BLOCKS } from './builder.seeds';

const MAX_CODE = 100_000;
const MAX_ITEMS = 100;
const MAX_LIST = 50;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new BadRequestException(`${field} e obrigatorio`);
    return '';
  }
  if (typeof value !== 'string') throw new BadRequestException(`${field} deve ser texto`);
  if (value.length > max)
    throw new BadRequestException(`${field} passa do limite de ${max} caracteres`);
  if (required && !value.trim()) throw new BadRequestException(`${field} e obrigatorio`);
  return value;
}

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException(`${field} deve ser uma lista`);
  const out = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 64) {
      throw new BadRequestException(`${field} tem um item invalido`);
    }
    out.add(entry.trim());
  }
  if (out.size > MAX_LIST)
    throw new BadRequestException(`${field} passa do limite de ${MAX_LIST} itens`);
  return [...out];
}

function normalizePermissions(value: unknown): BlockPermissions {
  const p = (value ?? {}) as Record<string, unknown>;
  if (typeof p !== 'object' || Array.isArray(p))
    throw new BadRequestException('permissions deve ser um objeto');
  return {
    read: stringList(p.read, 'permissions.read'),
    write: stringList(p.write, 'permissions.write'),
    tools: stringList(p.tools, 'permissions.tools'),
  };
}

// Grade de 12 colunas x linhas de 40px; canvas em pixels. Um lado e derivado do outro.
const CANVAS_COL = 100;
const CANVAS_ROW = 50;

function gridFromCanvas(c: Rect): Rect {
  const w = clampInt(Math.round(c.w / CANVAS_COL), 1, 12, 4);
  return {
    x: Math.min(clampInt(Math.round((c.x - 20) / CANVAS_COL), 0, 11, 0), 12 - w),
    y: clampInt(Math.round((c.y - 20) / CANVAS_ROW), 0, 500, 0),
    w,
    h: clampInt(Math.round(c.h / CANVAS_ROW), 1, 60, 6),
  };
}

export function canvasFromGrid(g: Rect): Rect {
  return {
    x: g.x * CANVAS_COL + 20,
    y: g.y * CANVAS_ROW + 20,
    w: g.w * CANVAS_COL - 12,
    h: g.h * CANVAS_ROW - 10,
  };
}

function rect(value: unknown, kind: 'grid' | 'canvas'): Rect | undefined {
  if (value === undefined || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r !== 'object') throw new BadRequestException(`${kind} deve ser um objeto {x,y,w,h}`);
  if (kind === 'grid') {
    const w = clampInt(r.w, 1, 12, 4);
    return {
      x: Math.min(clampInt(r.x, 0, 11, 0), 12 - w),
      y: clampInt(r.y, 0, 500, 0),
      w,
      h: clampInt(r.h, 1, 60, 6),
    };
  }
  return {
    x: clampInt(r.x, -50_000, 50_000, 40),
    y: clampInt(r.y, -50_000, 50_000, 40),
    w: clampInt(r.w, 120, 4000, 360),
    h: clampInt(r.h, 80, 4000, 260),
  };
}

@Injectable()
export class BuilderService implements OnModuleInit {
  private readonly logger = new Logger(BuilderService.name);

  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus,
  ) {}

  /** Blocos e painel embutidos sao reaplicados a cada subida: melhorias chegam com a atualizacao. */
  onModuleInit(): void {
    const now = new Date().toISOString();
    for (const seed of SEED_BLOCKS) {
      const existing = repo.getBlock(this.db, seed.id);
      repo.saveBlock(this.db, {
        id: seed.id,
        name: seed.name,
        description: seed.description,
        html: seed.html,
        css: seed.css,
        js: seed.js,
        permissions: seed.permissions,
        refreshSeconds: seed.refreshSeconds,
        source: 'builtin',
        approved: true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
    const existing = repo.getDashboard(this.db, BASIC_DASHBOARD.id);
    repo.saveDashboard(this.db, {
      id: BASIC_DASHBOARD.id,
      name: BASIC_DASHBOARD.name,
      mode: existing?.mode ?? BASIC_DASHBOARD.mode,
      builtin: true,
      items: BASIC_DASHBOARD.items.map((item) => ({
        id: `it-${item.blockId}`,
        blockId: item.blockId,
        grid: item.grid,
        canvas: canvasFromGrid(item.grid),
      })),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.logger.log(`${SEED_BLOCKS.length} blocos e o painel basico prontos`);
  }

  // ---------------------------------------------------------------- blocos

  listBlocks() {
    return repo.listBlocks(this.db);
  }

  getBlock(id: string): Block {
    const block = repo.getBlock(this.db, id);
    if (!block) throw new NotFoundException('bloco nao encontrado');
    return block;
  }

  createBlock(input: Record<string, unknown>): Block {
    const source = input.source === 'agent' ? 'agent' : 'user';
    const now = new Date().toISOString();
    const block: Block = {
      id: randomUUID(),
      name: text(input.name, 'name', 80, true).trim(),
      description: text(input.description, 'description', 300).trim() || undefined,
      html: text(input.html, 'html', MAX_CODE),
      css: text(input.css, 'css', MAX_CODE),
      js: text(input.js, 'js', MAX_CODE),
      permissions: normalizePermissions(input.permissions),
      refreshSeconds: this.refresh(input.refreshSeconds),
      source,
      // aprovar e ato explicito de quem esta na tela do Construtor; quem cria por API nao se auto-aprova por padrao
      approved: input.approved === true,
      createdAt: now,
      updatedAt: now,
    };
    const saved = repo.saveBlock(this.db, block);
    this.emit('block.created', { blockId: saved.id, name: saved.name, source: saved.source });
    return saved;
  }

  updateBlock(id: string, input: Record<string, unknown>): Block {
    const block = this.getBlock(id);
    if (block.source === 'builtin')
      throw new ForbiddenException('bloco embutido: duplique para editar');
    const codeChanged = ['html', 'css', 'js', 'permissions', 'refreshSeconds'].some(
      (k) => input[k] !== undefined,
    );
    const next: Block = {
      ...block,
      name: input.name !== undefined ? text(input.name, 'name', 80, true).trim() : block.name,
      description:
        input.description !== undefined
          ? text(input.description, 'description', 300).trim() || undefined
          : block.description,
      html: input.html !== undefined ? text(input.html, 'html', MAX_CODE) : block.html,
      css: input.css !== undefined ? text(input.css, 'css', MAX_CODE) : block.css,
      js: input.js !== undefined ? text(input.js, 'js', MAX_CODE) : block.js,
      permissions:
        input.permissions !== undefined
          ? normalizePermissions(input.permissions)
          : block.permissions,
      refreshSeconds:
        input.refreshSeconds !== undefined
          ? this.refresh(input.refreshSeconds)
          : block.refreshSeconds,
      // mudar codigo ou permissoes revoga a aprovacao, a menos que a mudanca ja venha aprovada
      approved: input.approved === true ? true : codeChanged ? false : block.approved,
      updatedAt: new Date().toISOString(),
    };
    const saved = repo.saveBlock(this.db, next);
    this.emit('block.updated', { blockId: id, approved: saved.approved });
    return saved;
  }

  duplicateBlock(id: string): Block {
    const block = this.getBlock(id);
    const now = new Date().toISOString();
    const copy = repo.saveBlock(this.db, {
      ...block,
      id: randomUUID(),
      name: `${block.name} (cópia)`.slice(0, 80),
      source: 'user',
      // o conteudo copiado herda o estado de aprovacao de quem foi copiado
      approved: block.approved,
      createdAt: now,
      updatedAt: now,
    });
    this.emit('block.created', { blockId: copy.id, name: copy.name, source: copy.source });
    return copy;
  }

  removeBlock(id: string) {
    const block = this.getBlock(id);
    if (block.source === 'builtin')
      throw new ForbiddenException('bloco embutido nao pode ser excluido');
    repo.deleteBlock(this.db, id);
    // tira o bloco de todos os paineis que o usavam
    for (const dashboard of repo.listDashboards(this.db)) {
      if (dashboard.builtin) continue;
      const items = dashboard.items.filter((i) => i.blockId !== id);
      if (items.length !== dashboard.items.length) {
        repo.saveDashboard(this.db, { ...dashboard, items, updatedAt: new Date().toISOString() });
      }
    }
    this.emit('block.deleted', { blockId: id });
    return { ok: true };
  }

  private refresh(value: unknown): number {
    const n = clampInt(value, 0, 3600, 0);
    return n === 0 ? 0 : Math.max(5, n);
  }

  // ---------------------------------------------------------------- paineis

  listDashboards() {
    return repo.listDashboards(this.db);
  }

  getDashboard(id: string): Dashboard {
    const dashboard = repo.getDashboard(this.db, id);
    if (!dashboard) throw new NotFoundException('painel nao encontrado');
    return dashboard;
  }

  createDashboard(input: Record<string, unknown>): Dashboard {
    const now = new Date().toISOString();
    const dashboard = repo.saveDashboard(this.db, {
      id: randomUUID(),
      name: text(input.name, 'name', 80, true).trim(),
      mode: this.mode(input.mode),
      items: this.items(input.items),
      builtin: false,
      createdAt: now,
      updatedAt: now,
    });
    this.emit('dashboard.created', { dashboardId: dashboard.id, name: dashboard.name });
    return dashboard;
  }

  updateDashboard(id: string, input: Record<string, unknown>): Dashboard {
    const dashboard = this.getDashboard(id);
    if (dashboard.builtin) throw new ForbiddenException('painel embutido: duplique para editar');
    const saved = repo.saveDashboard(this.db, {
      ...dashboard,
      name: input.name !== undefined ? text(input.name, 'name', 80, true).trim() : dashboard.name,
      mode: input.mode !== undefined ? this.mode(input.mode) : dashboard.mode,
      items: input.items !== undefined ? this.items(input.items) : dashboard.items,
      updatedAt: new Date().toISOString(),
    });
    this.emit('dashboard.updated', { dashboardId: id });
    return saved;
  }

  duplicateDashboard(id: string): Dashboard {
    const dashboard = this.getDashboard(id);
    const now = new Date().toISOString();
    const copy = repo.saveDashboard(this.db, {
      ...dashboard,
      id: randomUUID(),
      name: `${dashboard.name} (cópia)`.slice(0, 80),
      builtin: false,
      items: dashboard.items.map((i) => ({ ...i, id: randomUUID() })),
      createdAt: now,
      updatedAt: now,
    });
    this.emit('dashboard.created', { dashboardId: copy.id, name: copy.name });
    return copy;
  }

  removeDashboard(id: string) {
    const dashboard = this.getDashboard(id);
    if (dashboard.builtin) throw new ForbiddenException('painel embutido nao pode ser excluido');
    repo.deleteDashboard(this.db, id);
    this.emit('dashboard.deleted', { dashboardId: id });
    return { ok: true };
  }

  private mode(value: unknown): DashboardMode {
    if (value === undefined || value === null) return 'grid';
    if (value !== 'grid' && value !== 'canvas')
      throw new BadRequestException('mode deve ser grid ou canvas');
    return value;
  }

  private items(value: unknown): DashboardItem[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException('items deve ser uma lista');
    if (value.length > MAX_ITEMS)
      throw new BadRequestException(`no maximo ${MAX_ITEMS} blocos por painel`);
    let nextY = 0;
    return value.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const blockId = text(item.blockId, 'items[].blockId', 80, true);
      if (!repo.getBlock(this.db, blockId))
        throw new BadRequestException(`bloco inexistente: ${blockId}`);
      let grid = rect(item.grid, 'grid');
      let canvas = rect(item.canvas, 'canvas');
      if (!grid && !canvas) grid = { x: 0, y: nextY, w: 4, h: 6 };
      if (grid && !canvas) canvas = canvasFromGrid(grid);
      if (canvas && !grid) grid = gridFromCanvas(canvas);
      nextY = Math.max(nextY, grid!.y + grid!.h);
      return {
        id: typeof item.id === 'string' && item.id.length <= 80 && item.id ? item.id : randomUUID(),
        blockId,
        grid: grid!,
        canvas: canvas!,
      };
    });
  }

  private emit(
    type:
      | 'block.created'
      | 'block.updated'
      | 'block.deleted'
      | 'dashboard.created'
      | 'dashboard.updated'
      | 'dashboard.deleted',
    payload: Record<string, unknown>,
  ) {
    this.eventsService.record(type, payload);
    this.eventBus.publish(type, payload);
  }
}
