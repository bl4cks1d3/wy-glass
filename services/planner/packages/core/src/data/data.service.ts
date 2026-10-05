import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Collection, CollectionField, CollectionFieldType } from "@planner-life/shared";
import type { PlannerDb } from "../db";
import { PLANNER_DB } from "../database/database.module";
import { PlannerEventBus } from "../eventBus";
import { EventsService } from "../events/events.service";

const NAME_RE = /^[a-z][a-z0-9_]{1,39}$/;
const FIELD_RE = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_FIELDS = new Set(["id", "createdat", "updatedat", "created_at", "updated_at"]);
const TYPES: CollectionFieldType[] = ["text", "longtext", "number", "date", "boolean", "select"];
const MAX_FIELDS = 40;
const MAX_RECORDS = 10_000;
const MAX_TEXT = 2_000;
const MAX_LONGTEXT = 20_000;

interface CollectionRow {
  id: string;
  name: string;
  label: string;
  description: string | null;
  fields: string;
  created_at: string;
  updated_at: string;
}

interface RecordRow {
  id: string;
  collection_id: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export type FlatRecord = { id: string; createdAt: string; updatedAt: string } & Record<string, unknown>;

function toCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    description: row.description ?? undefined,
    fields: JSON.parse(row.fields) as CollectionField[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecord(row: RecordRow): FlatRecord {
  const data = JSON.parse(row.data) as Record<string, unknown>;
  return { ...data, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
}

/**
 * "Banco de dados sob medida": colecoes com esquema definido em tempo de uso
 * (pelo usuario ou pelo Claude) e registros validados contra ele. Fica no mesmo
 * SQLite; os blocos do dashboard acessam como o recurso "col:<nome>".
 */
@Injectable()
export class DataService {
  constructor(
    @Inject(PLANNER_DB) private readonly db: PlannerDb,
    private readonly eventsService: EventsService,
    private readonly eventBus: PlannerEventBus
  ) {}

  // ---------------------------------------------------------------- colecoes

  listCollections(): Array<Collection & { records: number }> {
    const rows = this.db.prepare(`SELECT * FROM collections ORDER BY created_at ASC`).all() as unknown as CollectionRow[];
    return rows.map((r) => {
      const count = this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE collection_id = ?`).get(r.id) as { n: number };
      return { ...toCollection(r), records: count.n };
    });
  }

  getCollection(name: string): Collection {
    const row = this.db.prepare(`SELECT * FROM collections WHERE name = ?`).get(name) as CollectionRow | undefined;
    if (!row) throw new NotFoundException(`colecao nao encontrada: ${name}`);
    return toCollection(row);
  }

  createCollection(input: Record<string, unknown>): Collection {
    const name = this.slug(input.name, NAME_RE, "name (minusculas, numeros e _; comeca com letra; 2-40 caracteres)");
    const exists = this.db.prepare(`SELECT 1 FROM collections WHERE name = ?`).get(name);
    if (exists) throw new ConflictException(`ja existe uma colecao chamada ${name}`);
    const now = new Date().toISOString();
    const collection: Collection = {
      id: randomUUID(),
      name,
      label: this.text(input.label, "label", 80) || name,
      description: this.text(input.description, "description", 300) || undefined,
      fields: this.fields(input.fields),
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(`INSERT INTO collections (id, name, label, description, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(collection.id, collection.name, collection.label, collection.description ?? null, JSON.stringify(collection.fields), now, now);
    this.emit("collection.created", { collection: name });
    return collection;
  }

  updateCollection(name: string, input: Record<string, unknown>): Collection {
    const current = this.getCollection(name);
    const next: Collection = {
      ...current,
      label: input.label !== undefined ? this.text(input.label, "label", 80) || current.name : current.label,
      description: input.description !== undefined ? this.text(input.description, "description", 300) || undefined : current.description,
      fields: input.fields !== undefined ? this.fields(input.fields) : current.fields,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(`UPDATE collections SET label = ?, description = ?, fields = ?, updated_at = ? WHERE id = ?`)
      .run(next.label, next.description ?? null, JSON.stringify(next.fields), next.updatedAt, next.id);
    this.emit("collection.updated", { collection: name });
    return next;
  }

  removeCollection(name: string) {
    const collection = this.getCollection(name);
    this.db.prepare(`DELETE FROM records WHERE collection_id = ?`).run(collection.id);
    this.db.prepare(`DELETE FROM collections WHERE id = ?`).run(collection.id);
    this.emit("collection.deleted", { collection: name });
    return { ok: true };
  }

  // ---------------------------------------------------------------- registros

  listRecords(name: string, query: Record<string, string | undefined>): FlatRecord[] {
    const collection = this.getCollection(name);
    const rows = this.db
      .prepare(`SELECT * FROM records WHERE collection_id = ? ORDER BY created_at ASC`)
      .all(collection.id) as unknown as RecordRow[];
    let records = rows.map(toRecord);

    const fieldNames = new Set(collection.fields.map((f) => f.name));
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || !fieldNames.has(key)) continue;
      records = records.filter((r) => String(r[key] ?? "") === value);
    }
    const q = query.q?.trim().toLowerCase();
    if (q) {
      records = records.filter((r) => collection.fields.some((f) => String(r[f.name] ?? "").toLowerCase().includes(q)));
    }
    const sort = query.sort;
    if (sort && (fieldNames.has(sort) || sort === "createdAt" || sort === "updatedAt")) {
      const dir = query.order === "desc" ? -1 : 1;
      records.sort((a, b) => {
        const x = a[sort];
        const y = b[sort];
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return String(x ?? "").localeCompare(String(y ?? "")) * dir;
      });
    }
    const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(query.limit) || 500)));
    return records.slice(offset, offset + limit);
  }

  createRecord(name: string, input: Record<string, unknown>): FlatRecord {
    const collection = this.getCollection(name);
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE collection_id = ?`).get(collection.id) as { n: number };
    if (count.n >= MAX_RECORDS) throw new BadRequestException(`limite de ${MAX_RECORDS} registros por colecao`);
    const data = this.validate(collection, input, true);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`INSERT INTO records (id, collection_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, collection.id, JSON.stringify(data), now, now);
    this.emit("record.created", { collection: name, recordId: id });
    return { ...data, id, createdAt: now, updatedAt: now };
  }

  updateRecord(name: string, id: string, input: Record<string, unknown>): FlatRecord {
    const collection = this.getCollection(name);
    const row = this.db.prepare(`SELECT * FROM records WHERE id = ? AND collection_id = ?`).get(id, collection.id) as RecordRow | undefined;
    if (!row) throw new NotFoundException("registro nao encontrado");
    const merged = { ...(JSON.parse(row.data) as Record<string, unknown>), ...this.validate(collection, input, false) };
    // um campo enviado como null limpa o valor
    for (const [key, value] of Object.entries(input)) if (value === null) delete merged[key];
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE records SET data = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(merged), now, id);
    this.emit("record.updated", { collection: name, recordId: id });
    return { ...merged, id, createdAt: row.created_at, updatedAt: now };
  }

  removeRecord(name: string, id: string) {
    const collection = this.getCollection(name);
    const result = this.db.prepare(`DELETE FROM records WHERE id = ? AND collection_id = ?`).run(id, collection.id);
    if (Number(result.changes) === 0) throw new NotFoundException("registro nao encontrado");
    this.emit("record.deleted", { collection: name, recordId: id });
    return { ok: true };
  }

  // ---------------------------------------------------------------- validacao

  private slug(value: unknown, re: RegExp, what: string): string {
    if (typeof value !== "string" || !re.test(value)) throw new BadRequestException(`${what} invalido`);
    return value;
  }

  private text(value: unknown, field: string, max: number): string {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new BadRequestException(`${field} deve ser texto`);
    if (value.length > max) throw new BadRequestException(`${field} passa do limite de ${max} caracteres`);
    return value.trim();
  }

  private fields(value: unknown): CollectionField[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException("fields deve ser uma lista");
    if (value.length > MAX_FIELDS) throw new BadRequestException(`no maximo ${MAX_FIELDS} campos`);
    const seen = new Set<string>();
    return value.map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const name = this.slug(f.name, FIELD_RE, `nome de campo "${String(f.name)}" (minusculas, numeros e _; comeca com letra)`);
      if (RESERVED_FIELDS.has(name.replace(/_/g, "")) || RESERVED_FIELDS.has(name)) throw new BadRequestException(`nome de campo reservado: ${name}`);
      if (seen.has(name)) throw new BadRequestException(`campo repetido: ${name}`);
      seen.add(name);
      const type = f.type as CollectionFieldType;
      if (!TYPES.includes(type)) throw new BadRequestException(`tipo do campo ${name} deve ser: ${TYPES.join(", ")}`);
      const field: CollectionField = { name, type };
      if (typeof f.label === "string" && f.label.trim()) field.label = f.label.trim().slice(0, 80);
      if (f.required === true) field.required = true;
      if (type === "select") {
        const options = Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim()) : [];
        if (options.length === 0) throw new BadRequestException(`campo ${name} (select) precisa de options`);
        field.options = [...new Set(options)].slice(0, 50);
      }
      return field;
    });
  }

  private validate(collection: Collection, input: Record<string, unknown>, creating: boolean): Record<string, unknown> {
    const byName = new Map(collection.fields.map((f) => [f.name, f]));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
      const field = byName.get(key);
      if (!field) throw new BadRequestException(`campo desconhecido em ${collection.name}: ${key}`);
      if (value === null || value === undefined || value === "") continue;
      out[key] = this.coerce(field, value);
    }
    if (creating) {
      for (const field of collection.fields) {
        if (field.required && out[field.name] === undefined) throw new BadRequestException(`campo obrigatorio: ${field.name}`);
      }
    }
    return out;
  }

  private coerce(field: CollectionField, value: unknown): unknown {
    switch (field.type) {
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) throw new BadRequestException(`${field.name} deve ser um numero`);
        return n;
      }
      case "boolean":
        if (typeof value === "boolean") return value;
        if (value === "true" || value === "false") return value === "true";
        throw new BadRequestException(`${field.name} deve ser verdadeiro/falso`);
      case "date": {
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${field.name} deve ser uma data ISO (ex: 2026-09-30)`);
        return value;
      }
      case "select":
        if (typeof value !== "string" || !field.options?.includes(value)) throw new BadRequestException(`${field.name} deve ser um de: ${field.options?.join(", ")}`);
        return value;
      case "longtext":
      case "text":
        if (typeof value !== "string") throw new BadRequestException(`${field.name} deve ser texto`);
        if (value.length > (field.type === "text" ? MAX_TEXT : MAX_LONGTEXT)) throw new BadRequestException(`${field.name} passa do limite de caracteres`);
        return value;
    }
  }

  private emit(type: "collection.created" | "collection.updated" | "collection.deleted" | "record.created" | "record.updated" | "record.deleted", payload: Record<string, unknown>) {
    this.eventsService.record(type, payload);
    this.eventBus.publish(type, payload);
  }
}
