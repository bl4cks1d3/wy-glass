"use client";

import { useEffect, useState } from "react";
import { useSpeechToText } from "./use-speech-to-text";

export interface MicButtonProps {
  onFinalTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
  className?: string;
}

export default function MicButton({ onFinalTranscript, onInterim, className }: MicButtonProps) {
  // O suporte a SpeechRecognition so existe no navegador, entao o servidor
  // sempre renderiza sem o botao. So marcamos `mounted` depois do primeiro
  // render no cliente (useEffect roda pos-hidratacao), assim o HTML do
  // cliente bate com o do servidor na hidratacao e o React nao reclama.
  const [mounted, setMounted] = useState(false);
  const { supported, listening, interimText, start, stop } = useSpeechToText(onFinalTranscript);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (interimText) onInterim?.(interimText);
  }, [interimText, onInterim]);

  if (!mounted || !supported) return null;

  return (
    <button
      type="button"
      className={`mic-button ${listening ? "listening" : ""} ${className ?? ""}`}
      onClick={() => (listening ? stop() : start())}
      title={listening ? "Parar de ouvir" : "Falar comando"}
      aria-label={listening ? "Parar de ouvir" : "Falar comando"}
    >
      {listening ? "●" : "🎙"}
    </button>
  );
}
