"use client";

import { useState } from "react";
import {
  createHabit,
  deleteHabit,
  updateHabit,
  type CalendarEvent,
  type Habit,
  type Project,
  type Task,
} from "@/lib/api";

function formatDateTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function formatDuration(start: string, end?: string): string {
  if (!end) return "";
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${rest}` : `${hours}h`;
}

export interface HojeViewProps {
  tasks: Task[];
  projects: Project[];
  habits: Habit[];
  eventsTodayCount: number;
  calendarEvents: CalendarEvent[];
  onToggleTask: (task: Task) => void;
  onChange: () => void;
}

export default function HojeView({
  tasks,
  projects,
  habits,
  eventsTodayCount,
  calendarEvents,
  onToggleTask,
  onChange,
}: HojeViewProps) {
  const [showNewHabit, setShowNewHabit] = useState(false);
  const [newHabit, setNewHabit] = useState({ name: "", unit: "", target: "" });
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  async function handleCreateHabit() {
    if (!newHabit.name.trim()) return;
    await createHabit({
      name: newHabit.name.trim(),
      unit: newHabit.unit.trim() || undefined,
      target: newHabit.target ? Number(newHabit.target) : undefined,
    });
    setNewHabit({ name: "", unit: "", target: "" });
    setShowNewHabit(false);
    onChange();
  }

  async function adjustHabit(h: Habit, delta: number) {
    await updateHabit(h.id, { current: Math.max(0, h.current + delta) });
    onChange();
  }

  async function handleDeleteHabit(id: string) {
    await deleteHabit(id);
    onChange();
  }

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">{today}</div>
          <h1 className="view-title">Bom dia</h1>
        </div>
        <div className="stat-row">
          <div>
            <div className="stat-label">Tarefas</div>
            <div className="stat-value">
              {doneCount}/{tasks.length}
            </div>
          </div>
          <div>
            <div className="stat-label">Projetos</div>
            <div className="stat-value">{projects.length}</div>
          </div>
          <div>
            <div className="stat-label">Eventos hoje</div>
            <div className="stat-value">{eventsTodayCount}</div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <section className="col-divider">
          <div className="section-head">
            <h2>Agenda</h2>
            <span className="section-meta">Google Calendar</span>
          </div>
          {calendarEvents.length === 0 && (
            <p style={{ padding: "16px 24px", color: "var(--color-neutral-700)", fontSize: 14 }}>
              Nenhum evento futuro (ou o Google Calendar ainda não está conectado).
            </p>
          )}
          {calendarEvents.map((e) => (
            <div key={e.id} className="row-divider" style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr) auto", gap: 14, alignItems: "baseline", padding: "13px 24px" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 13 }}>{formatDateTime(e.start)}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{e.title}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                  {e.calendarName}
                  {e.location ? ` · ${e.location}` : ""}
                </span>
              </span>
              <span style={{ fontSize: 10, letterSpacing: "0.03em", textTransform: "uppercase", fontWeight: 600, color: "var(--color-neutral-700)" }}>
                {formatDuration(e.start, e.end)}
              </span>
            </div>
          ))}

          <div className="section-head" style={{ borderTop: "1px solid var(--color-divider)" }}>
            <h2>Tarefas</h2>
            <span className="section-meta">
              {doneCount} de {tasks.length} concluídas
            </span>
          </div>
          {tasks.length === 0 && (
            <p style={{ padding: "16px 24px", color: "var(--color-neutral-700)", fontSize: 14 }}>
              Nenhuma tarefa ainda. Peça pro agente criar uma, ou crie em Projetos.
            </p>
          )}
          {tasks.map((t) => {
            const done = t.status === "done";
            const project = projects.find((p) => p.id === t.projectId);
            return (
              <button key={t.id} className="task-row" onClick={() => onToggleTask(t)}>
                <span className="task-check">
                  <span
                    className="task-check-fill"
                    style={{ background: done ? "var(--color-text)" : "transparent" }}
                  />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    className="task-title"
                    style={{
                      color: done ? "var(--color-neutral-600)" : "var(--color-text)",
                      textDecoration: done ? "line-through" : "none",
                    }}
                  >
                    {t.title}
                  </span>
                  <span className="task-project">
                    {project?.name ?? "sem projeto"}
                    {t.dueAt ? ` · ${formatDateTime(t.dueAt)}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        <section>
          <div className="section-head">
            <h2>Hábitos</h2>
            <button className="chat-listen" style={{ fontSize: 11 }} onClick={() => setShowNewHabit((v) => !v)}>
              {showNewHabit ? "cancelar" : "+ novo hábito"}
            </button>
          </div>

          {showNewHabit && (
            <div className="row-divider" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 24px" }}>
              <input
                className="chat-input"
                style={{ flex: "1 1 120px" }}
                placeholder="Nome (ex: Beber água)"
                value={newHabit.name}
                onChange={(e) => setNewHabit((s) => ({ ...s, name: e.target.value }))}
              />
              <input
                className="chat-input"
                style={{ flex: "0 1 80px" }}
                placeholder="Unidade"
                value={newHabit.unit}
                onChange={(e) => setNewHabit((s) => ({ ...s, unit: e.target.value }))}
              />
              <input
                className="chat-input"
                style={{ flex: "0 1 80px" }}
                type="number"
                placeholder="Meta"
                value={newHabit.target}
                onChange={(e) => setNewHabit((s) => ({ ...s, target: e.target.value }))}
              />
              <button className="btn btn-primary" onClick={handleCreateHabit}>
                Criar
              </button>
            </div>
          )}

          {habits.map((h) => {
            const pct = h.target > 0 ? Math.min(100, Math.round((h.current / h.target) * 100)) : 0;
            return (
              <div key={h.id} className="row-divider" style={{ padding: "13px 24px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{h.name}</span>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                    {h.current}
                    {h.target > 0 ? ` de ${h.target}` : ""} {h.unit}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="progress-track" style={{ flex: 1 }}>
                    <span className="progress-fill-bar" style={{ background: "var(--color-accent)", width: `${pct}%` }} />
                  </span>
                  <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => adjustHabit(h, -1)}>
                    −
                  </button>
                  <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => adjustHabit(h, 1)}>
                    +
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleDeleteHabit(h.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            );
          })}
          {habits.length === 0 && !showNewHabit && (
            <p style={{ padding: "16px 24px", color: "var(--color-neutral-700)", fontSize: 14 }}>
              Nenhum hábito ainda. Crie um (ex: beber água, treinar, ler).
            </p>
          )}

          <div className="section-head" style={{ borderTop: "1px solid var(--color-divider)" }}>
            <h2>Projetos</h2>
          </div>
          {projects.map((p) => (
            <div key={p.id} className="row-divider" style={{ padding: "13px 24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{p.progress}%</span>
              </div>
              <span className="progress-track">
                <span className="progress-fill-bar" style={{ background: "var(--color-text)", width: `${p.progress}%` }} />
              </span>
            </div>
          ))}
          {projects.length === 0 && (
            <p style={{ padding: "16px 24px", color: "var(--color-neutral-700)", fontSize: 14 }}>
              Nenhum projeto ainda.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
