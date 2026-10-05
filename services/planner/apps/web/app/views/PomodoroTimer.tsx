"use client";

import { useEffect, useRef, useState } from "react";
import { createStudySession, type Subject } from "@/lib/api";

const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface PomodoroTimerProps {
  subjects: Subject[];
  onSessionLogged: () => void;
}

/**
 * Timer Pomodoro simples: 25min de foco / 5min de intervalo. So registra
 * uma sessao de estudo quando um bloco de foco termina de verdade ou
 * quando o usuario para e escolhe registrar o tempo parcial -- pausar
 * sozinho nao grava nada.
 */
export default function PomodoroTimer({ subjects, onSessionLogged }: PomodoroTimerProps) {
  const [mode, setMode] = useState<"focus" | "break">("focus");
  const [secondsLeft, setSecondsLeft] = useState(FOCUS_MINUTES * 60);
  const [running, setRunning] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [message, setMessage] = useState("");
  const elapsedSecondsRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => s - 1);
      if (mode === "focus") elapsedSecondsRef.current += 1;
    }, 1000);
    return () => clearInterval(interval);
  }, [running, mode]);

  useEffect(() => {
    if (secondsLeft > 0) return;
    if (mode === "focus") {
      logSession(FOCUS_MINUTES);
      setMode("break");
      setSecondsLeft(BREAK_MINUTES * 60);
      setRunning(false);
      setMessage("Sessão registrada! Hora do intervalo.");
    } else {
      setMode("focus");
      setSecondsLeft(FOCUS_MINUTES * 60);
      setRunning(false);
      setMessage("Intervalo acabou -- pronto pra focar de novo.");
    }
  }, [secondsLeft, mode]);

  async function logSession(minutes: number) {
    const now = new Date();
    const startedAt = new Date(now.getTime() - minutes * 60_000).toISOString();
    await createStudySession({
      subjectId: subjectId || undefined,
      durationMinutes: minutes,
      startedAt,
      endedAt: now.toISOString(),
    });
    elapsedSecondsRef.current = 0;
    onSessionLogged();
  }

  function start() {
    setMessage("");
    setRunning(true);
  }

  function pause() {
    setRunning(false);
  }

  async function stopAndLog() {
    setRunning(false);
    const minutes = Math.floor(elapsedSecondsRef.current / 60);
    if (mode === "focus" && minutes >= 1) {
      await logSession(minutes);
      setMessage(`${minutes} min registrados.`);
    } else {
      elapsedSecondsRef.current = 0;
      setMessage("");
    }
    setMode("focus");
    setSecondsLeft(FOCUS_MINUTES * 60);
  }

  return (
    <div className="pomodoro">
      <div className="pomodoro-clock">{formatClock(secondsLeft)}</div>
      <div className="pomodoro-mode">{mode === "focus" ? "Foco" : "Intervalo"}</div>
      {mode === "focus" && (
        <select
          className="chat-input"
          style={{ marginTop: 10, width: "100%" }}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={running}
        >
          <option value="">Sem disciplina específica</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center" }}>
        {!running && (
          <button className="btn btn-primary" onClick={start}>
            {elapsedSecondsRef.current > 0 ? "Continuar" : "Iniciar"}
          </button>
        )}
        {running && (
          <button className="btn btn-secondary" onClick={pause}>
            Pausar
          </button>
        )}
        {(running || elapsedSecondsRef.current > 0) && (
          <button className="btn btn-secondary" onClick={stopAndLog}>
            Parar e registrar
          </button>
        )}
      </div>
      {message && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-700)", textAlign: "center" }}>
          {message}
        </div>
      )}
    </div>
  );
}
