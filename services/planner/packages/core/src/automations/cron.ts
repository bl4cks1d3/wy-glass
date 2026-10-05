// Cron de 5 campos (minuto hora dia-do-mes mes dia-da-semana), no horario local
// da maquina. Aceita "*", listas (1,15), intervalos (1-5) e passos ("*" barra 10,
// "10-30" barra 5). Dia da semana: 0-6 (domingo = 0; 7 tambem vale domingo).
// Sem nomes (mon, jan) e sem apelidos (@daily): quem escreve a automacao (o
// Claude) converte para numeros.
export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const FIELDS: Array<{ name: string; min: number; max: number }> = [
  { name: 'minuto', min: 0, max: 59 },
  { name: 'hora', min: 0, max: 23 },
  { name: 'dia do mes', min: 1, max: 31 },
  { name: 'mes', min: 1, max: 12 },
  { name: 'dia da semana', min: 0, max: 7 },
];

function parseField(raw: string, spec: { name: string; min: number; max: number }): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron: ${spec.name} invalido: "${raw}"`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`cron: passo invalido em ${spec.name}: "${raw}"`);
    let from = spec.min;
    let to = spec.max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number);
      from = a;
      // "5/10" (sem faixa) vai de 5 ate o maximo do campo
      to = b === undefined ? (m[2] === undefined ? a : spec.max) : b;
    }
    if (from < spec.min || to > spec.max || from > to) {
      throw new Error(`cron: ${spec.name} fora do intervalo ${spec.min}-${spec.max}: "${raw}"`);
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec {
  const parts = String(expr ?? '')
    .trim()
    .split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `cron precisa de 5 campos (minuto hora dia-do-mes mes dia-da-semana), recebi ${parts.length}: "${expr}"`,
    );
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

/** Confere se `date` (minuto cheio, horario local) casa com o cron. */
export function cronMatches(spec: CronSpec, date: Date): boolean {
  if (
    !spec.minute.has(date.getMinutes()) ||
    !spec.hour.has(date.getHours()) ||
    !spec.month.has(date.getMonth() + 1)
  ) {
    return false;
  }
  const domOk = spec.dom.has(date.getDate());
  const dowOk = spec.dow.has(date.getDay());
  // regra classica do cron: se os dois campos estao restritos, basta um casar
  if (!spec.domAny && !spec.dowAny) return domOk || dowOk;
  return domOk && dowOk;
}

/** Proximo disparo depois de `from` (ate ~1 ano), para mostrar na tela. */
export function nextCronRun(spec: CronSpec, from: Date): Date | undefined {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(spec, d)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return undefined;
}
