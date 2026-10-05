"use client";

import { useEffect, useState } from "react";
import {
  confirmClaudeCodeAction,
  getPendingClaudeCodeActions,
  rejectClaudeCodeAction,
  type ClaudeCodeAction,
} from "@/lib/api";

/**
 * O agente so registra um PEDIDO quando chama run_claude_code -- nada roda
 * de verdade ate o usuario confirmar aqui. Isso existe porque um assistente
 * autonomo (inclusive por comando de voz) disparando o Claude Code sem
 * ninguem no meio e um risco grande demais pra liberar sem essa checagem.
 */
export interface ClaudeCodeApprovalsProps {
  onChange?: () => void;
}

export default function ClaudeCodeApprovals({ onChange }: ClaudeCodeApprovalsProps) {
  const [pending, setPending] = useState<ClaudeCodeAction[]>([]);
  const [resolved, setResolved] = useState<ClaudeCodeAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const actions = await getPendingClaudeCodeActions();
      if (!cancelled) setPending(actions);
    }
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleConfirm(id: string) {
    setBusyId(id);
    try {
      const result = await confirmClaudeCodeAction(id);
      setPending((prev) => prev.filter((a) => a.id !== id));
      setResolved((prev) => [result, ...prev].slice(0, 5));
      onChange?.();
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setBusyId(id);
    try {
      await rejectClaudeCodeAction(id);
      setPending((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0 && resolved.length === 0) return null;

  return (
    <div className="claude-code-approvals">
      {pending.map((a) => (
        <div key={a.id} className="claude-code-card">
          <div className="claude-code-card-label">Claude Code pede confirmação</div>
          <div className="claude-code-card-prompt">{a.prompt}</div>
          <div className="claude-code-card-cwd">{a.cwd}</div>
          <div className="claude-code-card-actions">
            <button className="btn btn-primary" disabled={busyId === a.id} onClick={() => handleConfirm(a.id)}>
              {busyId === a.id ? "Rodando…" : "Confirmar"}
            </button>
            <button className="chat-listen" disabled={busyId === a.id} onClick={() => handleReject(a.id)}>
              Rejeitar
            </button>
          </div>
        </div>
      ))}
      {resolved.map((a) => (
        <div key={a.id} className={`claude-code-card resolved ${a.status}`}>
          <div className="claude-code-card-label">
            {a.status !== "done"
              ? "Erro no Claude Code"
              : a.kind === "research"
                ? "Pesquisa salva -- veja em Pesquisa"
                : "Claude Code executou"}
          </div>
          <div className="claude-code-card-prompt">{a.kind === "research" ? a.meta?.theme : a.prompt}</div>
          <div className="claude-code-card-output">{a.output || a.error}</div>
        </div>
      ))}
    </div>
  );
}
