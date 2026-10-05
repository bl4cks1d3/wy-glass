import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { PlpEventType } from "@planner-life/shared";

/**
 * Barramento de eventos em processo. O Planner Core emite eventos de
 * dominio aqui sempre que projetos/tarefas/memoria mudam. O bridge de P2P
 * (ver packages/p2p-node) escuta este emitter e republica os eventos para
 * a rede Planner Life (PLP), permitindo que outros dispositivos reajam.
 */
@Injectable()
export class PlannerEventBus extends EventEmitter {
  publish(type: PlpEventType, payload: Record<string, unknown>): void {
    this.emit("event", { type, payload });
  }
}
