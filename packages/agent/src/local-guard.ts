import { ForbiddenException } from '@nestjs/common';

export interface LocalRequest {
  socket: { remoteAddress?: string };
  headers: { origin?: string | string[] };
}

export function allowedOrigins(): Set<string> {
  const extra = (process.env.TOOLS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return new Set(['http://localhost:4300', 'http://127.0.0.1:4300', ...extra]);
}

/**
 * Rotas que agem direto (ferramentas, avisos), sem passar pelo LLM, so aceitam
 * chamadas da propria maquina e, quando vierem de um navegador, so do dashboard
 * (Origin conhecida): outra pagina aberta no navegador nao consegue dispara-las.
 */
export function assertLocalCaller(req: LocalRequest): void {
  const addr = req.socket.remoteAddress ?? '';
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
    throw new ForbiddenException('so aceita chamadas da propria maquina');
  }
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  if (origin && !allowedOrigins().has(origin)) {
    throw new ForbiddenException('origem nao permitida');
  }
}
