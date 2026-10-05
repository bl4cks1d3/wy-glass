"use client";

import { useEffect, useState } from "react";
import { getSettings, updateSettings, type SettingField } from "@/lib/api";

type Draft = Record<string, string>;

function fieldsToDraft(fields: SettingField[]): Draft {
  const draft: Draft = {};
  for (const f of fields) {
    draft[f.key] = f.isSecret ? "" : f.value ?? "";
  }
  return draft;
}

export default function SettingsView() {
  const [fields, setFields] = useState<SettingField[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    getSettings().then((f) => {
      setFields(f);
      setDraft(fieldsToDraft(f));
      setLoading(false);
    });
  }, []);

  function field(key: string): SettingField | undefined {
    return fields.find((f) => f.key === key);
  }

  function set(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSavedMsg("");
    try {
      const updates: Record<string, string> = {};
      for (const [key, value] of Object.entries(draft)) {
        const f = field(key);
        // segredo vazio + ja configurado = usuario nao mexeu, nao sobrescreve
        if (f?.isSecret && value === "" && f.hasValue) continue;
        updates[key] = value;
      }
      await updateSettings(updates);
      const fresh = await getSettings();
      setFields(fresh);
      setDraft(fieldsToDraft(fresh));
      setSavedMsg("Salvo! Reinicie os serviços afetados para aplicar (notificações já valem na hora).");
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : "falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div>
        <div className="view-header">
          <div>
            <div className="view-kicker">Planner Life</div>
            <h1 className="view-title">Configurações</h1>
          </div>
        </div>
        <p className="pad-24" style={{ color: "var(--color-neutral-700)" }}>
          Carregando…
        </p>
      </div>
    );
  }

  const secretPlaceholder = (key: string) =>
    field(key)?.hasValue ? "•••••••• (já configurada — deixe em branco pra manter)" : "cole a chave aqui";

  return (
    <div>
      <div className="view-header">
        <div>
          <div className="view-kicker">Planner Life</div>
          <h1 className="view-title">Configurações</h1>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>

      {savedMsg && (
        <div className="pad-24 row-divider" style={{ fontSize: 13, color: "var(--color-accent-700)" }}>
          {savedMsg}
        </div>
      )}

      <div className="section-head">
        <h2>IA -- provedor e modelos</h2>
        <span className="section-meta">chaves com free tier: Groq e Gemini</span>
      </div>
      <div className="pad-24 row-divider" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          Provedor (deixe em branco pra escolher automaticamente pela primeira chave preenchida)
          <select
            className="chat-input"
            style={{ marginTop: 4, width: "100%" }}
            value={draft.AGENT_PROVIDER ?? ""}
            onChange={(e) => set("AGENT_PROVIDER", e.target.value)}
          >
            <option value="">Automático</option>
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ fontSize: 13 }}>
            Groq API Key
            <input
              className="chat-input"
              style={{ marginTop: 4, width: "100%" }}
              type="password"
              placeholder={secretPlaceholder("GROQ_API_KEY")}
              value={draft.GROQ_API_KEY ?? ""}
              onChange={(e) => set("GROQ_API_KEY", e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Modelo Groq
            <input
              className="chat-input"
              style={{ marginTop: 4, width: "100%" }}
              value={draft.GROQ_MODEL ?? ""}
              onChange={(e) => set("GROQ_MODEL", e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Gemini API Key
            <input
              className="chat-input"
              style={{ marginTop: 4, width: "100%" }}
              type="password"
              placeholder={secretPlaceholder("GEMINI_API_KEY")}
              value={draft.GEMINI_API_KEY ?? ""}
              onChange={(e) => set("GEMINI_API_KEY", e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Modelo Gemini
            <input
              className="chat-input"
              style={{ marginTop: 4, width: "100%" }}
              value={draft.GEMINI_MODEL ?? ""}
              onChange={(e) => set("GEMINI_MODEL", e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Anthropic API Key
            <input
              className="chat-input"
              style={{ marginTop: 4, width: "100%" }}
              type="password"
              placeholder={secretPlaceholder("ANTHROPIC_API_KEY")}
              value={draft.ANTHROPIC_API_KEY ?? ""}
              onChange={(e) => set("ANTHROPIC_API_KEY", e.target.value)}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Modelo Anthropic
            <input
              className="chat-input"
              style={{ marginTop: 4, width: "100%" }}
              value={draft.ANTHROPIC_MODEL ?? ""}
              onChange={(e) => set("ANTHROPIC_MODEL", e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="section-head">
        <h2>Voz (Piper)</h2>
        <span className="section-meta">TTS local em português</span>
      </div>
      <div className="pad-24 row-divider" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          Caminho do binário do Piper
          <input
            className="chat-input"
            style={{ marginTop: 4, width: "100%" }}
            placeholder="deixe em branco pra usar packages/voice/vendor"
            value={draft.PIPER_BIN ?? ""}
            onChange={(e) => set("PIPER_BIN", e.target.value)}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Caminho do modelo de voz (.onnx)
          <input
            className="chat-input"
            style={{ marginTop: 4, width: "100%" }}
            placeholder="deixe em branco pra usar packages/voice/vendor"
            value={draft.PIPER_MODEL ?? ""}
            onChange={(e) => set("PIPER_MODEL", e.target.value)}
          />
        </label>
      </div>

      <div className="section-head">
        <h2>Notas (Obsidian)</h2>
        <span className="section-meta">aplica na hora, sem restart</span>
      </div>
      <div className="pad-24 row-divider">
        <label style={{ fontSize: 13 }}>
          Pasta do vault
          <input
            className="chat-input"
            style={{ marginTop: 4, width: "100%" }}
            placeholder="deixe em branco pra usar data/vault dentro do projeto"
            value={draft.OBSIDIAN_VAULT_PATH ?? ""}
            onChange={(e) => set("OBSIDIAN_VAULT_PATH", e.target.value)}
          />
        </label>
      </div>

      <div className="section-head">
        <h2>Claude Code (terminal)</h2>
      </div>
      <div className="pad-24 row-divider">
        <label style={{ fontSize: 13 }}>
          Pasta onde os comandos rodam por padrão
          <input
            className="chat-input"
            style={{ marginTop: 4, width: "100%" }}
            value={draft.CLAUDE_CODE_CWD ?? ""}
            onChange={(e) => set("CLAUDE_CODE_CWD", e.target.value)}
          />
        </label>
      </div>

      <div className="section-head">
        <h2>Notificações proativas</h2>
        <span className="section-meta">aplica na hora, sem restart</span>
      </div>
      <div className="pad-24" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="morning"
            checked={draft.MORNING_BRIEFING_ENABLED !== "false"}
            onChange={(e) => set("MORNING_BRIEFING_ENABLED", String(e.target.checked))}
          />
          <label htmlFor="morning" style={{ fontSize: 13 }}>
            Resumo da manhã, às
          </label>
          <input
            className="chat-input"
            type="number"
            min={0}
            max={23}
            style={{ width: 70 }}
            value={draft.MORNING_BRIEFING_HOUR ?? "8"}
            onChange={(e) => set("MORNING_BRIEFING_HOUR", e.target.value)}
          />
          <span style={{ fontSize: 13 }}>h</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="reminder"
            checked={draft.EVENT_REMINDER_ENABLED !== "false"}
            onChange={(e) => set("EVENT_REMINDER_ENABLED", String(e.target.checked))}
          />
          <label htmlFor="reminder" style={{ fontSize: 13 }}>
            Avisar
          </label>
          <input
            className="chat-input"
            type="number"
            min={1}
            max={120}
            style={{ width: 70 }}
            value={draft.EVENT_REMINDER_MINUTES ?? "15"}
            onChange={(e) => set("EVENT_REMINDER_MINUTES", e.target.value)}
          />
          <span style={{ fontSize: 13 }}>min antes de cada compromisso</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="gtasks"
            checked={draft.GOOGLE_TASKS_REMINDER_ENABLED !== "false"}
            onChange={(e) => set("GOOGLE_TASKS_REMINDER_ENABLED", String(e.target.checked))}
          />
          <label htmlFor="gtasks" style={{ fontSize: 13 }}>
            Avisar quando uma tarefa do Google Tasks atrasar ou vencer hoje
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            id="sound"
            checked={draft.NOTIFICATION_SOUND_ENABLED !== "false"}
            onChange={(e) => set("NOTIFICATION_SOUND_ENABLED", String(e.target.checked))}
          />
          <label htmlFor="sound" style={{ fontSize: 13 }}>
            Som ao aparecer uma notificação no navegador (o app desktop já usa o som do sistema)
          </label>
        </div>
      </div>
    </div>
  );
}
