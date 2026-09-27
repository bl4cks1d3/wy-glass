import type { Reminder } from './types.js';

const MINUTE = 60_000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isHHMM(s: unknown): s is string {
  return typeof s === 'string' && HHMM.test(s);
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Local Date at `hhmm` on the calendar day of `day`. */
function atTime(day: Date, hhmm: string): Date {
  const d = new Date(day);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Clamp `t` into the reminder's daily window: before it -> window start the
 *  same day; after it -> window start the next day. Windows may not wrap past
 *  midnight (start must be before end); without a window `t` is returned. */
export function clampToWindow(t: number, windowStart?: string, windowEnd?: string): number {
  if (!windowStart || !windowEnd) return t;
  const d = new Date(t);
  const mins = d.getHours() * 60 + d.getMinutes();
  const start = minutesOfDay(windowStart);
  const end = minutesOfDay(windowEnd);
  if (start >= end) return t;
  if (mins < start) return atTime(d, windowStart).getTime();
  if (mins > end) {
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return atTime(next, windowStart).getTime();
  }
  return t;
}

export interface ReminderInput {
  text: string;
  /** Fire once, this many minutes from now. */
  inMinutes?: number;
  /** Fire at this local HH:MM (today, or tomorrow if already past). */
  at?: string;
  /** Repeat every N minutes (>= 5). */
  everyMinutes?: number;
  windowStart?: string;
  windowEnd?: string;
}

/** Validate input and compute the first firing time. Returns an error string
 *  instead of throwing so the office tool can hand it back to the agent. */
export function buildReminder(
  agent: string,
  input: ReminderInput,
  id: string,
  now = Date.now(),
): Reminder | string {
  const text = input.text?.trim();
  if (!text) return 'texto vazio';
  if (input.everyMinutes !== undefined && (!Number.isFinite(input.everyMinutes) || input.everyMinutes < 5)) {
    return 'a_cada_minutos deve ser pelo menos 5';
  }
  if ((input.windowStart && !isHHMM(input.windowStart)) || (input.windowEnd && !isHHMM(input.windowEnd))) {
    return 'janela deve estar no formato HH:MM';
  }
  if (input.at !== undefined && !isHHMM(input.at)) return 'horario deve estar no formato HH:MM';

  let first: number;
  if (input.at) {
    const today = atTime(new Date(now), input.at).getTime();
    first = today > now ? today : today + 24 * 60 * MINUTE;
  } else if (input.inMinutes !== undefined) {
    if (!Number.isFinite(input.inMinutes) || input.inMinutes < 1) return 'em_minutos deve ser pelo menos 1';
    first = now + Math.round(input.inMinutes) * MINUTE;
  } else if (input.everyMinutes !== undefined) {
    first = now + Math.round(input.everyMinutes) * MINUTE;
  } else {
    return 'informe em_minutos, horario ou a_cada_minutos';
  }

  const everyMinutes = input.everyMinutes !== undefined ? Math.round(input.everyMinutes) : undefined;
  return {
    id,
    agent,
    text,
    ...(everyMinutes ? { everyMinutes } : {}),
    ...(input.windowStart && input.windowEnd ? { windowStart: input.windowStart, windowEnd: input.windowEnd } : {}),
    nextAt: everyMinutes ? clampToWindow(first, input.windowStart, input.windowEnd) : first,
    active: true,
    createdAt: now,
  };
}

/** After firing at `firedAt`: the next time, or null for a one-shot. Skips
 *  missed repetitions (the machine was asleep) instead of firing a backlog. */
export function nextAfterFiring(r: Reminder, firedAt: number): number | null {
  if (!r.everyMinutes) return null;
  const step = r.everyMinutes * MINUTE;
  let next = r.nextAt + step;
  if (next <= firedAt) next = firedAt + step;
  return clampToWindow(next, r.windowStart, r.windowEnd);
}

export function describeReminder(r: Reminder): string {
  const when = new Date(r.nextAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const every = r.everyMinutes ? `a cada ${r.everyMinutes} min` : 'uma vez';
  const window = r.windowStart ? ` (${r.windowStart}–${r.windowEnd})` : '';
  return `${r.id} | ${r.text} | ${every}${window} | próximo: ${when}${r.active ? '' : ' | pausado'}`;
}
