"use client";

import { useState } from "react";
import { createMemory, deleteMemory, type MemoryEntry } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export interface MemoriaViewProps {
  entries: MemoryEntry[];
  onChange: () => void;
}

export default function MemoriaView({ entries, onChange }: MemoriaViewProps) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ content: "", tags: "" });

  async function handleCreate() {
    if (!draft.content.trim()) return;
    await createMemory({
      content: draft.content.trim(),
      tags: draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setDraft({ content: "", tags: "" });
    setShowNew(false);
    onChange();
  }

  async function handleDelete(id: string) {
    await deleteMemory(id);
    onChange();
  }

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Contexto de longo prazo</div>
          <h1 className="view-title">Memória</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancelar" : "+ Nova memória"}
        </button>
      </div>

      {showNew && (
        <div className="pad-24 row-divider" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            className="chat-input"
            style={{ flex: "2 1 300px" }}
            placeholder="O que guardar (preferência, fato, contexto recorrente)"
            value={draft.content}
            onChange={(e) => setDraft((s) => ({ ...s, content: e.target.value }))}
          />
          <input
            className="chat-input"
            style={{ flex: "1 1 180px" }}
            placeholder="tags separadas por vírgula"
            value={draft.tags}
            onChange={(e) => setDraft((s) => ({ ...s, tags: e.target.value }))}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Salvar
          </button>
        </div>
      )}

      {entries.map((m) => (
        <div key={m.id} className="row-divider" style={{ padding: "13px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 14, flex: 1 }}>{m.content}</div>
            <button className="chat-listen" style={{ fontSize: 11 }} onClick={() => handleDelete(m.id)}>
              excluir
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
              {formatDate(m.createdAt)} · {m.source}
            </span>
            {m.tags.map((t) => (
              <span key={t} className="tag tag-neutral">
                {t}
              </span>
            ))}
          </div>
        </div>
      ))}
      {entries.length === 0 && !showNew && (
        <p className="pad-24" style={{ color: "var(--color-neutral-700)", fontSize: 14 }}>
          Nenhuma memória salva ainda. O agente salva automaticamente coisas
          importantes que você conta, ou você pode adicionar manualmente aqui.
        </p>
      )}
    </div>
  );
}
