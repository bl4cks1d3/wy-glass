"use client";

import { Fragment, useState } from "react";
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  setTaskStatus,
  updateProject,
  updateTask,
  type Project,
  type Task,
} from "@/lib/api";

export interface ProjetosViewProps {
  projects: Project[];
  tasks: Task[];
  onChange: () => void;
}

export default function ProjetosView({ projects, tasks, onChange }: ProjetosViewProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", goal: "" });

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState({ name: "", goal: "", progress: "0" });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({ title: "", dueAt: "" });

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState({ title: "", dueAt: "" });

  async function handleCreateProject() {
    if (!newProject.name.trim()) return;
    await createProject({ name: newProject.name.trim(), goal: newProject.goal.trim() || undefined });
    setNewProject({ name: "", goal: "" });
    setShowNewProject(false);
    onChange();
  }

  function startEditProject(p: Project) {
    setEditingProjectId(p.id);
    setEditProject({ name: p.name, goal: p.goal ?? "", progress: String(p.progress) });
  }

  async function saveEditProject(id: string) {
    await updateProject(id, {
      name: editProject.name.trim(),
      goal: editProject.goal.trim() || undefined,
      progress: Number(editProject.progress),
    });
    setEditingProjectId(null);
    onChange();
  }

  async function handleDeleteProject(id: string) {
    if (!confirm("Excluir este projeto e todas as suas tarefas?")) return;
    await deleteProject(id);
    onChange();
  }

  async function handleCreateTask(projectId: string) {
    if (!newTask.title.trim()) return;
    await createTask({ title: newTask.title.trim(), projectId, dueAt: newTask.dueAt || undefined });
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

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Planner Core</div>
          <h1 className="view-title">Projetos</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNewProject((v) => !v)}>
          {showNewProject ? "Cancelar" : "+ Novo projeto"}
        </button>
      </div>

      {showNewProject && (
        <div className="pad-24 row-divider" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            className="chat-input"
            style={{ flex: "1 1 200px" }}
            placeholder="Nome do projeto"
            value={newProject.name}
            onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
          />
          <input
            className="chat-input"
            style={{ flex: "2 1 260px" }}
            placeholder="Objetivo (opcional)"
            value={newProject.goal}
            onChange={(e) => setNewProject((p) => ({ ...p, goal: e.target.value }))}
          />
          <button className="btn btn-primary" onClick={handleCreateProject}>
            Criar
          </button>
        </div>
      )}

      <div className="pad-24" style={{ overflowX: "auto" }}>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Objetivo</th>
              <th>Tarefas</th>
              <th>Progresso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const projectTasks = tasks.filter((t) => t.projectId === p.id);
              const done = projectTasks.filter((t) => t.status === "done").length;
              const isEditing = editingProjectId === p.id;
              return (
                <Fragment key={p.id}>
                  <tr>
                    {isEditing ? (
                      <>
                        <td>
                          <input
                            className="chat-input"
                            value={editProject.name}
                            onChange={(e) => setEditProject((s) => ({ ...s, name: e.target.value }))}
                          />
                        </td>
                        <td>
                          <input
                            className="chat-input"
                            value={editProject.goal}
                            onChange={(e) => setEditProject((s) => ({ ...s, goal: e.target.value }))}
                          />
                        </td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {done}/{projectTasks.length}
                        </td>
                        <td>
                          <input
                            className="chat-input"
                            type="number"
                            min={0}
                            max={100}
                            style={{ width: 70 }}
                            value={editProject.progress}
                            onChange={(e) => setEditProject((s) => ({ ...s, progress: e.target.value }))}
                          />
                          %
                        </td>
                        <td style={{ display: "flex", gap: 6 }}>
                          <button className="btn btn-primary" onClick={() => saveEditProject(p.id)}>
                            Salvar
                          </button>
                          <button className="btn btn-secondary" onClick={() => setEditingProjectId(null)}>
                            Cancelar
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ fontWeight: 600, cursor: "pointer" }} onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                          {expandedId === p.id ? "▾ " : "▸ "}
                          {p.name}
                        </td>
                        <td style={{ color: "var(--color-neutral-700)" }}>{p.goal ?? "—"}</td>
                        <td style={{ fontVariantNumeric: "tabular-nums" }}>
                          {done}/{projectTasks.length}
                        </td>
                        <td style={{ width: 140 }}>
                          <span className="progress-track">
                            <span
                              className="progress-fill-bar"
                              style={{ background: "var(--color-accent)", width: `${p.progress}%` }}
                            />
                          </span>
                        </td>
                        <td style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                          <button className="btn btn-secondary" onClick={() => startEditProject(p)}>
                            Editar
                          </button>
                          <button className="btn btn-secondary" onClick={() => handleDeleteProject(p.id)}>
                            Excluir
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                  {expandedId === p.id && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--color-neutral-100)" }}>
                        <div style={{ padding: "8px 4px" }}>
                          {projectTasks.map((t) =>
                            editingTaskId === t.id ? (
                              <div key={t.id} style={{ display: "flex", gap: 8, padding: "6px 0", flexWrap: "wrap" }}>
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
                                style={{
                                  display: "flex",
                                  gap: 8,
                                  alignItems: "center",
                                  padding: "6px 0",
                                  borderBottom: "1px solid var(--color-divider)",
                                }}
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
                                <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                                  {t.dueAt ? new Date(t.dueAt).toLocaleString("pt-BR") : ""}
                                </span>
                                <button className="btn btn-secondary" onClick={() => startEditTask(t)}>
                                  Editar
                                </button>
                                <button className="btn btn-secondary" onClick={() => handleDeleteTask(t.id)}>
                                  Excluir
                                </button>
                              </div>
                            )
                          )}
                          <div style={{ display: "flex", gap: 8, paddingTop: 8, flexWrap: "wrap" }}>
                            <input
                              className="chat-input"
                              style={{ flex: "1 1 200px" }}
                              placeholder="Nova tarefa neste projeto"
                              value={newTask.title}
                              onChange={(e) => setNewTask((s) => ({ ...s, title: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreateTask(p.id);
                              }}
                            />
                            <input
                              className="chat-input"
                              type="datetime-local"
                              style={{ flex: "0 1 200px" }}
                              value={newTask.dueAt}
                              onChange={(e) => setNewTask((s) => ({ ...s, dueAt: e.target.value }))}
                            />
                            <button className="btn btn-primary" onClick={() => handleCreateTask(p.id)}>
                              + Adicionar
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: "var(--color-neutral-700)" }}>
                  Nenhum projeto ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
