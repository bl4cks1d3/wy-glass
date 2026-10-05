"use client";

import { useState } from "react";
import { runClaudeCode } from "@/lib/api";

interface HistoryEntry {
  id: string;
  prompt: string;
  output?: string;
  error?: string;
  running: boolean;
}

let nextId = 1;

/**
 * Terminal direto pro Claude Code: diferente do fluxo do agente (que so
 * registra um pedido e espera confirmacao no chat), aqui e voce mesmo
 * escrevendo e enviando o prompt -- isso ja e a confirmacao humana, entao
 * roda na hora.
 */
export default function TerminalView() {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [running, setRunning] = useState(false);

  async function handleRun() {
    const text = prompt.trim();
    if (!text || running) return;
    const id = String(nextId++);
    setPrompt("");
    setRunning(true);
    setHistory((prev) => [{ id, prompt: text, running: true }, ...prev]);
    try {
      const result = await runClaudeCode(text);
      setHistory((prev) =>
        prev.map((h) => (h.id === id ? { ...h, running: false, output: result.output, error: result.error } : h))
      );
    } catch (err) {
      setHistory((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, running: false, error: err instanceof Error ? err.message : String(err) } : h
        )
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Claude Code</div>
          <h1 className="view-title">Terminal</h1>
        </div>
      </div>

      <div className="pad-24" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea
          className="chat-input"
          style={{ minHeight: 90, fontFamily: "ui-monospace, monospace", fontSize: 13, resize: "vertical" }}
          placeholder="Escreva o prompt pro Claude Code (ex: 'liste os arquivos de packages/core/src/study e explique o que cada um faz')"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun();
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>Ctrl/Cmd+Enter para enviar</span>
          <button className="btn btn-primary" onClick={handleRun} disabled={running}>
            {running ? "Executando…" : "Executar"}
          </button>
        </div>
      </div>

      <div className="section-head">
        <h2>Histórico</h2>
      </div>
      {history.map((h) => (
        <div key={h.id} className="row-divider pad-24">
          <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {h.prompt}
          </div>
          {h.running && <div style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>Rodando…</div>}
          {!h.running && h.output && (
            <div
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                background: "var(--color-neutral-100)",
                borderRadius: "var(--radius-sm)",
                padding: 12,
                maxHeight: 400,
                overflowY: "auto",
              }}
            >
              {h.output}
            </div>
          )}
          {!h.running && h.error && (
            <div style={{ fontSize: 12, color: "var(--color-accent-700)" }}>{h.error}</div>
          )}
        </div>
      ))}
      {history.length === 0 && (
        <p className="pad-24" style={{ color: "var(--color-neutral-700)", fontSize: 14 }}>
          Nenhum comando rodado ainda nesta sessão.
        </p>
      )}
    </div>
  );
}
