"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  deleteVaultNote,
  getVaultNote,
  saveVaultNote,
  searchVaultNotes,
  type VaultNoteMeta,
} from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export interface NotasViewProps {
  notes: VaultNoteMeta[];
  onChange: () => void;
}

export default function NotasView({ notes, onChange }: NotasViewProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VaultNoteMeta[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newNote, setNewNote] = useState({ path: "", content: "# " });

  const list = results ?? notes;

  async function handleSearch() {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setResults(await searchVaultNotes(query.trim()));
  }

  async function openNote(path: string) {
    setSelectedPath(path);
    setEditing(false);
    setLoading(true);
    try {
      const note = await getVaultNote(path);
      setContent(note.content);
    } catch (err) {
      setContent(err instanceof Error ? err.message : "falha ao ler a nota");
    } finally {
      setLoading(false);
    }
  }

  function startEdit() {
    setDraftContent(content);
    setEditing(true);
  }

  async function saveEdit() {
    if (!selectedPath) return;
    await saveVaultNote(selectedPath, draftContent);
    setContent(draftContent);
    setEditing(false);
    onChange();
  }

  async function handleDelete(path: string) {
    if (!confirm(`Excluir a nota "${path}"?`)) return;
    await deleteVaultNote(path);
    if (selectedPath === path) {
      setSelectedPath(null);
      setContent("");
    }
    onChange();
  }

  async function handleCreate() {
    if (!newNote.path.trim()) return;
    const path = newNote.path.trim();
    await saveVaultNote(path, newNote.content);
    setNewNote({ path: "", content: "# " });
    setShowNew(false);
    onChange();
    openNote(path.toLowerCase().endsWith(".md") ? path : `${path}.md`);
  }

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Vault (Obsidian ou pasta local)</div>
          <h1 className="view-title">Notas</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancelar" : "+ Nova nota"}
        </button>
      </div>

      {showNew && (
        <div className="pad-24 row-divider" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            className="chat-input"
            style={{ flex: "1 1 220px" }}
            placeholder="Caminho, ex: Pesquisas/artigo.md"
            value={newNote.path}
            onChange={(e) => setNewNote((s) => ({ ...s, path: e.target.value }))}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Criar
          </button>
        </div>
      )}

      <div className="two-col">
        <section className="col-divider">
          <div className="pad-24" style={{ paddingBottom: 12, display: "flex", gap: 8 }}>
            <input
              className="chat-input"
              style={{ flex: 1 }}
              placeholder="Buscar notas…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
            />
            <button className="btn btn-secondary" onClick={handleSearch}>
              Buscar
            </button>
          </div>
          {list.map((n) => (
            <div
              key={n.path}
              className="row-divider"
              style={{
                padding: "12px 24px",
                cursor: "pointer",
                background: selectedPath === n.path ? "var(--color-neutral-100)" : "transparent",
              }}
              onClick={() => openNote(n.path)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{n.title}</div>
                <button
                  className="chat-listen"
                  style={{ fontSize: 11, flex: "0 0 auto" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(n.path);
                  }}
                >
                  excluir
                </button>
              </div>
              {n.excerpt && (
                <div style={{ fontSize: 12, color: "var(--color-neutral-700)", marginTop: 2 }}>{n.excerpt}</div>
              )}
              <div style={{ fontSize: 10, color: "var(--color-neutral-600)", marginTop: 4 }}>
                {n.path} · {formatDate(n.updatedAt)}
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <p className="pad-24" style={{ color: "var(--color-neutral-700)", fontSize: 14 }}>
              {results ? "Nenhuma nota encontrada." : "Nenhuma nota ainda. Peça pro agente pesquisar algo, ou crie uma."}
            </p>
          )}
        </section>

        <section>
          {!selectedPath && (
            <p className="pad-24" style={{ color: "var(--color-neutral-700)", fontSize: 14 }}>
              Selecione uma nota para ler.
            </p>
          )}
          {selectedPath && (
            <div>
              <div className="section-head">
                <h2>{selectedPath}</h2>
                {!editing && (
                  <button className="btn btn-secondary" onClick={startEdit}>
                    Editar
                  </button>
                )}
              </div>
              <div className="pad-24">
                {loading ? (
                  "Carregando…"
                ) : editing ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <textarea
                      className="chat-input"
                      style={{ minHeight: 320, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
                      value={draftContent}
                      onChange={(e) => setDraftContent(e.target.value)}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary" onClick={saveEdit}>
                        Salvar
                      </button>
                      <button className="btn btn-secondary" onClick={() => setEditing(false)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="markdown-reader">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
