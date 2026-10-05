"use client";

import { useState } from "react";
import {
  createGoogleTask,
  createTask,
  deleteGoogleTask,
  deleteTask,
  setTaskStatus,
  updateGoogleTask,
  updateTask,
  type GoogleTask,
  type Task,
} from "@/lib/api";

export interface TarefasViewProps {
  tasks: Task[];
  googleTasks: GoogleTask[];
  onChange: () => void;
}

/**
 * Tarefas gerais (sem projeto e sem disciplina) -- "tirar o lixo" nao e um
 * estudo nem um projeto, entao fica aqui, junto com o Google Tasks. Tarefa
 * vinculada a projeto continua em Projetos; entrega/leitura de disciplina
 * continua em Estudos.
 */
export default function TarefasView({ tasks, googleTasks, onChange }: TarefasViewProps) {
  const looseTasks = tasks.filter((t) => !t.projectId);

  const [newTask, setNewTask] = useState({ title: "", dueAt: "" });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState({ title: "", dueAt: "" });

  const [newGTask, setNewGTask] = useState({ title: "", due: "" });
  const [editingGTaskId, setEditingGTaskId] = useState<string | null>(null);
  const [editGTask, setEditGTask] = useState({ title: "", due: "" });
  const [syncing, setSyncing] = useState(false);

  // O Google Tasks ja e buscado ao vivo (sem cache) a cada onChange --
  // "sincronizar" aqui e so dar um feedback visual claro de que buscou de
  // novo agora, igual ao botao de sincronizar do Gmail no Inbox.
  async function handleSyncGoogleTasks() {
    setSyncing(true);
    try {
      onChange();
    } finally {
      setTimeout(() => setSyncing(false), 600);
    }
  }

  function dateToGoogleDue(date: string): string | undefined {
    return date ? new Date(`${date}T00:00:00.000Z`).toISOString() : undefined;
  }
  function googleDueToDateInput(due?: string): string {
    return due ? due.slice(0, 10) : "";
  }

  async function handleCreateTask() {
    if (!newTask.title.trim()) return;
    await createTask({ title: newTask.title.trim(), dueAt: newTask.dueAt || undefined });
    setNewTask({ title: "", dueAt: "" });
    onChange();
  }

  function startEditTask(t: Task) {
    setEditingTaskId(t.id);
    setEditTask({ title: t.title, dueAt: t.dueAt ? t.dueAt.slice(0, 16) : "" });
  }

  async function saveEditTask(id: string) {
    await updateTask(id, { title: editTask.title.trim(), dueAt: editTask.dueAt || null });
    setEditingTaskId(null);
    onChange();
  }

  async function handleDeleteTask(id: string) {
    await deleteTask(id);
    onChange();
  }

  async function handleToggleDone(t: Task) {
    await setTaskStatus(t.id, t.status === "done" ? "pending" : "done");
    onChange();
  }

  async function handleCreateGoogleTask() {
    if (!newGTask.title.trim()) return;
    await createGoogleTask({ title: newGTask.title.trim(), due: dateToGoogleDue(newGTask.due) });
    setNewGTask({ title: "", due: "" });
    onChange();
  }

  async function toggleGoogleTask(t: GoogleTask) {
    await updateGoogleTask(t.id, { status: t.status === "completed" ? "needsAction" : "completed" });
    onChange();
  }

  async function saveEditGTask(id: string) {
    await updateGoogleTask(id, { title: editGTask.title.trim(), due: dateToGoogleDue(editGTask.due) });
    setEditingGTaskId(null);
    onChange();
  }

  async function handleDeleteGoogleTask(id: string) {
    await deleteGoogleTask(id);
    onChange();
  }

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Tarefas gerais</div>
          <h1 className="view-title">Tarefas</h1>
        </div>
      </div>

      <div className="section-head">
        <h2>Planner</h2>
        <span className="section-meta">sem projeto vinculado -- tarefa de projeto fica em Projetos</span>
      </div>
      {looseTasks.map((t) =>
        editingTaskId === t.id ? (
          <div key={t.id} className="row-divider" style={{ display: "flex", gap: 8, padding: "10px 24px", flexWrap: "wrap" }}>
            <input
              className="chat-input"
              style={{ flex: "1 1 200px" }}
              value={editTask.title}
              onChange={(e) => setEditTask((s) => ({ ...s, title: e.target.value }))}
            />
            <input
              className="chat-input"
              type="datetime-local"
              style={{ flex: "0 1 200px" }}
              value={editTask.dueAt}
              onChange={(e) => setEditTask((s) => ({ ...s, dueAt: e.target.value }))}
            />
            <button className="btn btn-primary" onClick={() => saveEditTask(t.id)}>
              Salvar
            </button>
            <button className="btn btn-secondary" onClick={() => setEditingTaskId(null)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div
            key={t.id}
            className="row-divider"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px" }}
          >
            <input type="checkbox" checked={t.status === "done"} onChange={() => handleToggleDone(t)} />
            <span
              style={{
                flex: 1,
                textDecoration: t.status === "done" ? "line-through" : "none",
                color: t.status === "done" ? "var(--color-neutral-600)" : "var(--color-text)",
              }}
            >
              {t.title}
            </span>
            {t.dueAt && (
              <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                {new Date(t.dueAt).toLocaleString("pt-BR")}
              </span>
            )}
            <button className="btn btn-secondary" onClick={() => startEditTask(t)}>
              Editar
            </button>
            <button className="btn btn-secondary" onClick={() => handleDeleteTask(t.id)}>
              Excluir
            </button>
          </div>
        )
      )}
      {looseTasks.length === 0 && (
        <p className="pad-24" style={{ color: "var(--color-neutral-700)", fontSize: 14 }}>
          Nenhuma tarefa solta ainda.
        </p>
      )}
      <div className="pad-24" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="chat-input"
          style={{ flex: "1 1 200px" }}
          placeholder="Nova tarefa (ex: tirar o lixo)"
          value={newTask.title}
          onChange={(e) => setNewTask((s) => ({ ...s, title: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateTask();
          }}
        />
        <input
          className="chat-input"
          type="datetime-local"
          style={{ flex: "0 1 200px" }}
          value={newTask.dueAt}
          onChange={(e) => setNewTask((s) => ({ ...s, dueAt: e.target.value }))}
        />
        <button className="btn btn-primary" onClick={handleCreateTask}>
          + Adicionar
        </button>
      </div>

      <div className="section-head" style={{ borderTop: "1px solid var(--color-divider)" }}>
        <h2>Google Tasks</h2>
        <span className="section-meta" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          CRUD completo, sincronizado com a conta Google
          <button className="btn btn-secondary" onClick={handleSyncGoogleTasks} disabled={syncing}>
            {syncing ? "Sincronizando…" : "🔄 Sincronizar"}
          </button>
        </span>
      </div>
      {googleTasks.map((t) =>
        editingGTaskId === t.id ? (
          <div key={t.id} className="row-divider" style={{ display: "flex", gap: 8, padding: "10px 24px", flexWrap: "wrap" }}>
            <input
              className="chat-input"
              style={{ flex: "1 1 200px" }}
              value={editGTask.title}
              onChange={(e) => setEditGTask((s) => ({ ...s, title: e.target.value }))}
            />
            <input
              className="chat-input"
              type="date"
              style={{ flex: "0 1 160px" }}
              value={editGTask.due}
              onChange={(e) => setEditGTask((s) => ({ ...s, due: e.target.value }))}
            />
            <button className="btn btn-primary" onClick={() => saveEditGTask(t.id)}>
              Salvar
            </button>
            <button className="btn btn-secondary" onClick={() => setEditingGTaskId(null)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div
            key={t.id}
            className="row-divider"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 24px" }}
          >
            <input type="checkbox" checked={t.status === "completed"} onChange={() => toggleGoogleTask(t)} />
            <span
              style={{
                flex: 1,
                textDecoration: t.status === "completed" ? "line-through" : "none",
                color: t.status === "completed" ? "var(--color-neutral-600)" : "var(--color-text)",
              }}
            >
              {t.title}
            </span>
            {t.due && (
              <span style={{ fontSize: 11, color: "var(--color-neutral-700)", fontVariantNumeric: "tabular-nums" }}>
                {new Date(t.due).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
              </span>
            )}
            <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{t.account}</span>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setEditingGTaskId(t.id);
                setEditGTask({ title: t.title, due: googleDueToDateInput(t.due) });
              }}
            >
              Editar
            </button>
            <button className="btn btn-secondary" onClick={() => handleDeleteGoogleTask(t.id)}>
              Excluir
            </button>
          </div>
        )
      )}
      {googleTasks.length === 0 && (
        <p className="pad-24" style={{ color: "var(--color-neutral-700)", fontSize: 14 }}>
          Nenhuma tarefa no Google Tasks (ou nenhuma conta Google conectada ainda).
        </p>
      )}
      <div className="pad-24" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="chat-input"
          style={{ flex: "1 1 200px" }}
          placeholder="Nova tarefa no Google Tasks"
          value={newGTask.title}
          onChange={(e) => setNewGTask((s) => ({ ...s, title: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateGoogleTask();
          }}
        />
        <input
          className="chat-input"
          type="date"
          style={{ flex: "0 1 160px" }}
          value={newGTask.due}
          onChange={(e) => setNewGTask((s) => ({ ...s, due: e.target.value }))}
        />
        <button className="btn btn-primary" onClick={handleCreateGoogleTask}>
          + Adicionar
        </button>
      </div>
    </div>
  );
}
