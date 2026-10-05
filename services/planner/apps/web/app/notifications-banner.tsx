"use client";

import { useEffect, useRef, useState } from "react";
import { ackNotification, getPendingNotifications, getSettings, type AgentNotification } from "@/lib/api";

/**
 * Mesma fila de notificacoes proativas que o app desktop mostra como
 * notificacao nativa do SO (com som padrao do sistema) -- aqui aparece
 * como um toast flutuante com seu proprio aviso sonoro (gerado por Web
 * Audio, sem precisar de arquivo de audio), pra quem esta pelo navegador
 * tambem perceber o Jarvis avisando sozinho.
 */
export default function NotificationsBanner() {
  const [items, setItems] = useState<AgentNotification[]>([]);
  const soundEnabledRef = useRef(true);
  const audioCtxRef = useRef<AudioContext | null>(null);

  function getAudioCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtxRef.current = new Ctor();
    }
    return audioCtxRef.current;
  }

  function playChime() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    ctx.resume().catch(() => undefined);
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  useEffect(() => {
    getSettings().then((fields) => {
      const f = fields.find((x) => x.key === "NOTIFICATION_SOUND_ENABLED");
      soundEnabledRef.current = f?.value !== "false";
    });
    // navegadores so deixam o Web Audio tocar de verdade depois de algum
    // gesto do usuario na pagina -- isso "destranca" o contexto assim que
    // a pessoa clicar em qualquer coisa, bem antes de a primeira notificacao
    // de verdade aparecer.
    const unlock = () => getAudioCtx()?.resume().catch(() => undefined);
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const pending = await getPendingNotifications();
      if (cancelled || pending.length === 0) return;
      setItems((prev) => {
        const fresh = pending.filter((p) => !prev.some((x) => x.id === p.id));
        if (fresh.length > 0 && soundEnabledRef.current) playChime();
        return [...prev, ...fresh];
      });
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    ackNotification(id);
  }

  if (items.length === 0) return null;

  return (
    <div className="notifications-stack">
      {items.map((n) => (
        <div key={n.id} className="notification-toast">
          <div className="notification-toast-title">{n.title}</div>
          <div className="notification-toast-body">{n.body}</div>
          <button className="chat-listen" style={{ marginTop: 6 }} onClick={() => dismiss(n.id)}>
            dispensar
          </button>
        </div>
      ))}
    </div>
  );
}
