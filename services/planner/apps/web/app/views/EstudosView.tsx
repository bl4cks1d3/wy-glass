"use client";

import { useState } from "react";
import {
  createScheduleBlock,
  createStudyTopic,
  createSubject,
  deleteScheduleBlock,
  deleteStudyTopic,
  deleteSubject,
  setStudyTopicDone,
  updateSubject,
  type ScheduleBlock,
  type StudySession,
  type StudyTopic,
  type Subject,
} from "@/lib/api";
import PomodoroTimer from "./PomodoroTimer";

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function examBadge(examDate?: string): { label: string; urgent: boolean } | null {
  if (!examDate) return null;
  const days = daysUntil(examDate);
  if (days < 0) return { label: "prova já passou", urgent: false };
  if (days === 0) return { label: "prova é hoje", urgent: true };
  if (days === 1) return { label: "prova amanhã", urgent: true };
  return { label: `prova em ${days} dias`, urgent: days <= 5 };
}

export interface EstudosViewProps {
  subjects: Subject[];
  topics: StudyTopic[];
  schedule: ScheduleBlock[];
  sessions: StudySession[];
  onChange: () => void;
}

export default function EstudosView({ subjects, topics, schedule, sessions, onChange }: EstudosViewProps) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ name: "", note: "", examDate: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({ progress: "", note: "", examDate: "" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState({ title: "", dueAt: "" });

  const [newBlock, setNewBlock] = useState({ subjectId: "", dayOfWeek: "1", startTime: "19:00", endTime: "21:00" });

  // Entrega/leitura = topico de qualquer disciplina com prazo, ainda nao
  // concluido -- nativo de Estudos, nao depende de tarefa/projeto nenhum
  // (estudo de faculdade, autoestudo ou cursinho, tanto faz).
  const deliveries = topics
    .filter((t) => t.dueAt && !t.done)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());

  async function handleCreate() {
    if (!draft.name.trim()) return;
    await createSubject({
      name: draft.name.trim(),
      note: draft.note.trim() || undefined,
      examDate: draft.examDate || undefined,
    });
    setDraft({ name: "", note: "", examDate: "" });
    setShowNew(false);
    onChange();
  }

  function startEdit(s: Subject) {
    setEditingId(s.id);
    setEdit({ progress: String(s.progress), note: s.note ?? "", examDate: s.examDate?.slice(0, 10) ?? "" });
  }

  async function saveEdit(id: string) {
    await updateSubject(id, {
      progress: Number(edit.progress),
      note: edit.note.trim() || undefined,
      examDate: edit.examDate || null,
    });
    setEditingId(null);
    onChange();
  }

  async function handleDelete(id: string) {
    await deleteSubject(id);
    onChange();
  }

  async function handleAddTopic(subjectId: string) {
    if (!newTopic.title.trim()) return;
    await createStudyTopic({
      subjectId,
      title: newTopic.title.trim(),
      dueAt: newTopic.dueAt ? new Date(newTopic.dueAt).toISOString() : undefined,
    });
    setNewTopic({ title: "", dueAt: "" });
    onChange();
  }

  async function toggleTopic(t: StudyTopic) {
    await setStudyTopicDone(t.id, !t.done);
    onChange();
  }

  async function handleDeleteTopic(id: string) {
    await deleteStudyTopic(id);
    onChange();
  }

  async function handleAddBlock() {
    if (!newBlock.subjectId) return;
    await createScheduleBlock({
      subjectId: newBlock.subjectId,
      dayOfWeek: Number(newBlock.dayOfWeek),
      startTime: newBlock.startTime,
      endTime: newBlock.endTime,
    });
    onChange();
  }

  async function handleDeleteBlock(id: string) {
    await deleteScheduleBlock(id);
    onChange();
  }

  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? "?";

  const minutesBySubject = new Map<string, number>();
  let totalMinutes = 0;
  for (const s of sessions) {
    totalMinutes += s.durationMinutes;
    if (s.subjectId) minutesBySubject.set(s.subjectId, (minutesBySubject.get(s.subjectId) ?? 0) + s.durationMinutes);
  }

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Study Agent</div>
          <h1 className="view-title">Estudos</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
          {showNew ? "Cancelar" : "+ Nova disciplina"}
        </button>
      </div>

      {showNew && (
        <div className="pad-24 row-divider" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            className="chat-input"
            style={{ flex: "1 1 200px" }}
            placeholder="Nome da disciplina"
            value={draft.name}
            onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
          />
          <input
            className="chat-input"
            style={{ flex: "1 1 160px" }}
            placeholder="Nota / observação"
            value={draft.note}
            onChange={(e) => setDraft((s) => ({ ...s, note: e.target.value }))}
          />
          <input
            className="chat-input"
            type="date"
            style={{ flex: "0 1 160px" }}
            title="Data da prova (opcional)"
            value={draft.examDate}
            onChange={(e) => setDraft((s) => ({ ...s, examDate: e.target.value }))}
          />
          <button className="btn btn-primary" onClick={handleCreate}>
            Criar
          </button>
        </div>
      )}

      <div className="two-col">
        <section className="col-divider">
          <div className="section-head">
            <h2>Disciplinas</h2>
          </div>
          {subjects.map((s) => {
            const badge = examBadge(s.examDate);
            const subjectTopics = topics.filter((t) => t.subjectId === s.id);
            const doneCount = subjectTopics.filter((t) => t.done).length;
            return editingId === s.id ? (
              <div key={s.id} className="row-divider" style={{ display: "flex", gap: 8, padding: "10px 24px", flexWrap: "wrap" }}>
                <input
                  className="chat-input"
                  type="number"
                  style={{ flex: "0 1 100px" }}
                  placeholder="Progresso %"
                  value={edit.progress}
                  onChange={(e) => setEdit((v) => ({ ...v, progress: e.target.value }))}
                />
                <input
                  className="chat-input"
                  style={{ flex: "1 1 160px" }}
                  placeholder="Nota / observação"
                  value={edit.note}
                  onChange={(e) => setEdit((v) => ({ ...v, note: e.target.value }))}
                />
                <input
                  className="chat-input"
                  type="date"
                  style={{ flex: "0 1 160px" }}
                  value={edit.examDate}
                  onChange={(e) => setEdit((v) => ({ ...v, examDate: e.target.value }))}
                />
                <button className="btn btn-primary" onClick={() => saveEdit(s.id)}>
                  Salvar
                </button>
                <button className="btn btn-secondary" onClick={() => setEditingId(null)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <div key={s.id} className="row-divider" style={{ padding: "13px 24px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 7 }}>
                  <span
                    style={{ fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  >
                    {expandedId === s.id ? "▾ " : "▸ "}
                    {s.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{s.note ?? ""}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="progress-track" style={{ flex: 1, minWidth: 80 }}>
                    <span className="progress-fill-bar" style={{ background: "var(--color-text)", width: `${s.progress}%` }} />
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{s.progress}%</span>
                  {subjectTopics.length > 0 && (
                    <span className="tag tag-neutral">
                      {doneCount}/{subjectTopics.length} tópicos
                    </span>
                  )}
                  {badge && (
                    <span
                      className="tag tag-outline"
                      style={badge.urgent ? { borderColor: "var(--color-accent)", color: "var(--color-accent)" } : undefined}
                    >
                      {badge.label}
                    </span>
                  )}
                  <button className="btn btn-secondary" onClick={() => startEdit(s)}>
                    Editar
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleDelete(s.id)}>
                    Excluir
                  </button>
                </div>
                {expandedId === s.id && (
                  <div style={{ marginTop: 10, paddingLeft: 4 }}>
                    {subjectTopics.map((t) => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                        <input type="checkbox" checked={t.done} onChange={() => toggleTopic(t)} />
                        <span
                          style={{
                            flex: 1,
                            fontSize: 13,
                            textDecoration: t.done ? "line-through" : "none",
                            color: t.done ? "var(--color-neutral-600)" : "var(--color-text)",
                          }}
                        >
                          {t.title}
                        </span>
                        {t.dueAt && (
                          <span style={{ fontSize: 10, color: "var(--color-accent-700)" }}>{formatDate(t.dueAt)}</span>
                        )}
                        <button className="chat-listen" style={{ fontSize: 10 }} onClick={() => handleDeleteTopic(t.id)}>
                          excluir
                        </button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      <input
                        className="chat-input"
                        style={{ flex: "1 1 160px", fontSize: 12 }}
                        placeholder="Novo tópico (ex: Capítulo 3, ou 'Entregar resenha')"
                        value={newTopic.title}
                        onChange={(e) => setNewTopic((v) => ({ ...v, title: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddTopic(s.id);
                        }}
                      />
                      <input
                        className="chat-input"
                        type="date"
                        style={{ flex: "0 1 140px", fontSize: 12 }}
                        title="Prazo (opcional) -- vira uma entrega/leitura"
                        value={newTopic.dueAt}
                        onChange={(e) => setNewTopic((v) => ({ ...v, dueAt: e.target.value }))}
                      />
                      <button className="btn btn-secondary" onClick={() => handleAddTopic(s.id)}>
                        + Tópico
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {subjects.length === 0 && !showNew && (
            <p style={{ padding: "16px 24px", color: "var(--color-neutral-700)", fontSize: 14 }}>
              Nenhuma disciplina cadastrada ainda.
            </p>
          )}
        </section>
        <section>
          <div className="section-head">
            <h2>Entregas e leituras</h2>
            <span className="section-meta">tópicos com prazo, de qualquer disciplina</span>
          </div>
          {deliveries.map((d) => (
            <div key={d.id} className="entry-row">
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--color-accent)",
                }}
              >
                {formatDate(d.dueAt!)}
              </span>
              <span>
                <span style={{ fontSize: 14 }}>{d.title}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                  {subjectName(d.subjectId)}
                </span>
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={d.done} onChange={() => toggleTopic(d)} title="Marcar como feita" />
                <button className="chat-listen" style={{ fontSize: 10 }} onClick={() => handleDeleteTopic(d.id)}>
                  excluir
                </button>
              </span>
            </div>
          ))}
          {deliveries.length === 0 && (
            <p style={{ padding: "16px 24px", color: "var(--color-neutral-700)", fontSize: 14 }}>
              Nenhuma entrega com prazo definido. Abra uma disciplina e adicione um tópico com data.
            </p>
          )}
        </section>
      </div>

      <div className="section-head" style={{ borderTop: "1px solid var(--color-divider)" }}>
        <h2>Cronograma semanal</h2>
        <span className="section-meta">horários fixos de estudo por disciplina</span>
      </div>
      <div className="schedule-grid">
        {DAY_LABELS.map((label, day) => (
          <div key={day} className="schedule-day">
            <div className="schedule-day-label">{label}</div>
            {schedule
              .filter((b) => b.dayOfWeek === day)
              .map((b) => (
                <div key={b.id} className="schedule-block">
                  <div className="schedule-block-time">
                    {b.startTime}–{b.endTime}
                  </div>
                  <div className="schedule-block-subject">{subjectName(b.subjectId)}</div>
                  <button className="chat-listen" style={{ fontSize: 9 }} onClick={() => handleDeleteBlock(b.id)}>
                    excluir
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="pad-24" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select
          className="chat-input"
          style={{ flex: "1 1 160px" }}
          value={newBlock.subjectId}
          onChange={(e) => setNewBlock((s) => ({ ...s, subjectId: e.target.value }))}
        >
          <option value="">Disciplina…</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="chat-input"
          style={{ flex: "0 1 120px" }}
          value={newBlock.dayOfWeek}
          onChange={(e) => setNewBlock((s) => ({ ...s, dayOfWeek: e.target.value }))}
        >
          {DAY_LABELS.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="chat-input"
          type="time"
          style={{ flex: "0 1 110px" }}
          value={newBlock.startTime}
          onChange={(e) => setNewBlock((s) => ({ ...s, startTime: e.target.value }))}
        />
        <input
          className="chat-input"
          type="time"
          style={{ flex: "0 1 110px" }}
          value={newBlock.endTime}
          onChange={(e) => setNewBlock((s) => ({ ...s, endTime: e.target.value }))}
        />
        <button className="btn btn-primary" onClick={handleAddBlock}>
          + Adicionar horário
        </button>
      </div>

      <div className="section-head" style={{ borderTop: "1px solid var(--color-divider)" }}>
        <h2>Pomodoro</h2>
        <span className="section-meta">{totalMinutes} min estudados nos últimos 14 dias</span>
      </div>
      <div className="two-col">
        <section className="col-divider pad-24">
          <PomodoroTimer subjects={subjects} onSessionLogged={onChange} />
        </section>
        <section className="pad-24">
          {Array.from(minutesBySubject.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([subjectId, minutes]) => (
              <div key={subjectId} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span>{subjectName(subjectId)}</span>
                <span style={{ color: "var(--color-neutral-700)" }}>{minutes} min</span>
              </div>
            ))}
          {minutesBySubject.size === 0 && (
            <p style={{ color: "var(--color-neutral-700)", fontSize: 13 }}>
              Nenhuma sessão registrada ainda -- use o Pomodoro ao lado.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
