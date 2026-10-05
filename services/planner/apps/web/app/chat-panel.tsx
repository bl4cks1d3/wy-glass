"use client";

import { useRef, useState } from "react";
import { sendChat, speak } from "@/lib/api";
import MicButton from "./mic-button";
import ClaudeCodeApprovals from "./claude-code-approvals";

interface ChatMessage {
  id: string;
  who: "Você" | "Planner Life";
  text: string;
}

const QUICK_PROMPTS = ["Planejar meu dia", "O que está atrasado?", "Faz minha revisão semanal"];

let nextId = 1;

export interface ChatPanelProps {
  onActivity?: () => void;
}

export default function ChatPanel({ onActivity }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      who: "Planner Life",
      text: "Oi! Sou o Personal Agent do Planner Life. Pergunte sobre suas tarefas, projetos, clientes ou peça para eu planejar seu dia.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const userMsg: ChatMessage = { id: String(nextId++), who: "Você", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setSending(true);
    try {
      const reply = await sendChat(trimmed);
      setMessages((prev) => [...prev, { id: String(nextId++), who: "Planner Life", text: reply }]);
      onActivity?.();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: String(nextId++),
          who: "Planner Life",
          text: err instanceof Error ? err.message : "erro ao falar com o agente",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleListen(message: ChatMessage) {
    setSpeakingId(message.id);
    try {
      const blob = await speak(message.text);
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch {
      // silencioso -- o botao so some se a voz nao estiver configurada
    } finally {
      setSpeakingId(null);
    }
  }

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <div className="topbar-label">Planner Life</div>
        <div className="chat-title">Assistente</div>
        <div className="chat-subtitle">Contexto: tarefas, projetos, clientes, memória</div>
      </div>

      <ClaudeCodeApprovals onChange={onActivity} />

      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.who === "Você" ? "me" : "agent"}`}>
            <div className="chat-bubble-meta">
              <span>{m.who}</span>
              {m.who === "Planner Life" && (
                <button
                  className="chat-listen"
                  onClick={() => handleListen(m)}
                  disabled={speakingId === m.id}
                >
                  {speakingId === m.id ? "gerando…" : "🔊 ouvir"}
                </button>
              )}
            </div>
            <div className="chat-bubble-text">{m.text}</div>
          </div>
        ))}
        {sending && (
          <div className="chat-bubble agent">
            <div className="chat-bubble-meta">
              <span>Planner Life</span>
            </div>
            <div className="chat-bubble-text">Pensando…</div>
          </div>
        )}
      </div>

      <div className="chat-footer">
        <div className="quick-prompts">
          {QUICK_PROMPTS.map((p) => (
            <button key={p} className="quick-prompt" onClick={() => send(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="chat-input-row">
          <input
            className="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(draft);
            }}
            placeholder="Pergunte ou mande executar…"
          />
          <MicButton onFinalTranscript={(text) => send(text)} onInterim={setDraft} />
          <button className="btn btn-primary" onClick={() => send(draft)} disabled={sending}>
            Enviar
          </button>
        </div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} hidden />
    </aside>
  );
}
