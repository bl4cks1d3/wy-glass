// Um terminal exposto e execucao remota de codigo, e WebSocket nao passa por
// CORS: sem checar Origin, qualquer site aberto no navegador conseguiria
// conectar em ws://127.0.0.1 e digitar comandos. Por isso: so loopback, so
// Origin conhecida e so Host conhecido (barra DNS rebinding).

const DEFAULT_ORIGINS = ["http://localhost:4300", "http://127.0.0.1:4300"];

export function allowedOrigins(): Set<string> {
  const extra = (process.env.TERMINAL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function originAllowed(origin: string | undefined): origin is string {
  return typeof origin === "string" && allowedOrigins().has(origin);
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
