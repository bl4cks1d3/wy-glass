/**
 * O motor do escritório nasceu dentro do Pixel Agents, que desenhava cada agente como um
 * personagem lendo o transcript do Claude. No Wy Glass não há sala de pixels: a interface é o orb
 * (a Central). Este módulo mantém a forma das peças que o motor usava, sem o desenho.
 */
import * as path from 'path';

export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;

/** Mesmo nome de pasta que o Claude usa em ~/.claude/projects/<nome>/. */
export function normalizeProjectPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

export interface AgentState {
  id: number;
  sessionId: string;
  jsonlFile: string;
  fileOffset: number;
  [key: string]: unknown;
}

/** Sem personagens: nada é guardado, e os avisos pro escritório vão para o SSE do /api/brain. */
export class AgentStateStore {
  has(_id: number): boolean {
    return false;
  }
  get(_id: number): AgentState | undefined {
    return undefined;
  }
  set(_id: number, _agent: AgentState): void {}
  broadcast(_message: Record<string, unknown>): void {}
}

export class AgentRuntime {
  readonly knownJsonlFiles = new Set<string>();
  readonly fileWatchers = new Map<number, unknown>();
  readonly pollingTimers = new Map<number, unknown>();
  readonly waitingTimers = new Map<number, unknown>();
  readonly permissionTimers = new Map<number, unknown>();
  registerAgent(_sessionId: string, _id: number): void {}
  unregisterAgent(_sessionId: string): void {}
  removeAgent(_id: number): void {}
}

export function assignPaletteIfNeeded(_agent: AgentState, _store: AgentStateStore): void {}

export function startFileWatching(..._args: unknown[]): void {}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

export const claudeProvider = {
  formatToolStatus(toolName: string, input?: unknown): string {
    const inp = (input ?? {}) as Record<string, unknown>;
    const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
    switch (toolName) {
      case 'Read':
        return `Reading ${base(inp.file_path)}`;
      case 'Edit':
        return `Editing ${base(inp.file_path)}`;
      case 'Write':
        return `Writing ${base(inp.file_path)}`;
      case 'Bash':
        return `Running: ${clip(typeof inp.command === 'string' ? inp.command : '', 30)}`;
      case 'Glob':
        return 'Searching files';
      case 'Grep':
        return 'Searching code';
      case 'WebFetch':
        return 'Fetching web content';
      case 'WebSearch':
        return 'Searching the web';
      case 'Task':
      case 'Agent': {
        const desc = typeof inp.description === 'string' ? inp.description : '';
        return desc ? `Subtask: ${clip(desc, 40)}` : 'Running subtask';
      }
      case 'AskUserQuestion':
        return 'Waiting for your answer';
      default:
        return `Using ${toolName}`;
    }
  },
};
