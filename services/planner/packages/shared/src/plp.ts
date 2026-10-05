/**
 * PLP - Planner Life Protocol
 *
 * Envelope minimo trocado entre nos da rede P2P (PC, Raspberry Pi, celular...).
 * Qualquer nome de topico pubsub deve usar PLP_TOPIC para que todos os nos
 * da rede Planner Life conversem no mesmo canal.
 */
export const PLP_TOPIC = "planner-life/events/v1";

export interface PlpMessage<T = Record<string, unknown>> {
  type: string;
  origin: string;
  createdAt: string;
  payload: T;
}

export function createPlpMessage<T>(
  type: string,
  origin: string,
  payload: T
): PlpMessage<T> {
  return { type, origin, createdAt: new Date().toISOString(), payload };
}
