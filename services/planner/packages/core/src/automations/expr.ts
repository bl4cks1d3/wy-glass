// Templates e condicoes das automacoes. Sem eval: e um interpretador pequeno
// e fechado, porque as definicoes vem de agentes e de texto de terceiros.
//
// Template  : "Ola {{trigger.payload.title}}"  |  "{{steps.a.result | length}}"
//             Se a string inteira for UM template, o valor mantem o tipo (lista, objeto, numero).
// Condicao  : steps.a.result.length > 0 && !(trigger.payload.status == "done")
// Caminhos  : trigger.payload.x, steps.<id>.result[0].y, item.z, index, now.date
// Filtros   : json, length, first, last, join, upper, lower

export type Ctx = Record<string, unknown>;
export type Warn = (message: string) => void;

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const PATH_SRC = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+|\\[\\d+\\])*';
const PATH_RE = new RegExp(`^${PATH_SRC}$`);
const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE_RE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const VALUE_EXPR_RE = new RegExp(`^${PATH_SRC}(?:\\s*\\|\\s*[a-z]+)*$`);
const MAX_DEPTH = 24;
const MAX_EXPR = 500;

export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (part === '') continue;
    if (cur === null || cur === undefined || FORBIDDEN.has(part)) return undefined;
    if (Array.isArray(cur)) {
      if (part === 'length') cur = cur.length;
      else if (/^\d+$/.test(part)) cur = cur[Number(part)];
      else return undefined;
    } else if (typeof cur === 'string') {
      if (part === 'length') cur = cur.length;
      else return undefined;
    } else if (typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function applyFilter(value: unknown, name: string): unknown {
  switch (name) {
    case 'json':
      return value === undefined ? '' : JSON.stringify(value);
    case 'length':
      if (Array.isArray(value) || typeof value === 'string') return value.length;
      if (value && typeof value === 'object') return Object.keys(value).length;
      return 0;
    case 'first':
      return Array.isArray(value) ? value[0] : value;
    case 'last':
      return Array.isArray(value) ? value[value.length - 1] : value;
    case 'join':
      return Array.isArray(value) ? value.map(stringify).join(', ') : stringify(value);
    case 'upper':
      return stringify(value).toUpperCase();
    case 'lower':
      return stringify(value).toLowerCase();
    default:
      throw new Error(
        `filtro desconhecido: "${name}" (use json, length, first, last, join, upper, lower)`,
      );
  }
}

/** Avalia `caminho | filtro | filtro` (o miolo de um {{ }}). */
function evalRef(ref: string, ctx: Ctx, warn?: Warn): unknown {
  const [path, ...filters] = ref.split('|').map((s) => s.trim());
  if (!PATH_RE.test(path)) throw new Error(`referencia invalida: {{${ref}}}`);
  let value = getPath(ctx, path);
  if (value === undefined) warn?.(`"${path}" nao existe`);
  for (const f of filters) value = applyFilter(value, f);
  return value;
}

export function renderTemplate(input: string, ctx: Ctx, warn?: Warn): unknown {
  const whole = WHOLE_RE.exec(input);
  if (whole) return evalRef(whole[1], ctx, warn);
  return input.replace(TEMPLATE_RE, (_m, ref: string) => stringify(evalRef(ref, ctx, warn)));
}

/** Resolve templates em qualquer estrutura JSON (strings, listas, objetos aninhados). */
export function resolveDeep(value: unknown, ctx: Ctx, warn?: Warn, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new Error('estrutura aninhada demais');
  if (typeof value === 'string') return renderTemplate(value, ctx, warn);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, ctx, warn, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k)) continue;
      out[k] = resolveDeep(v, ctx, warn, depth + 1);
    }
    return out;
  }
  return value;
}

/** Para forEach: aceita "{{steps.a.result}}" ou o caminho puro "steps.a.result". */
export function evalValueExpr(expr: string, ctx: Ctx, warn?: Warn): unknown {
  const t = expr.trim();
  if (WHOLE_RE.test(t)) return renderTemplate(t, ctx, warn);
  if (VALUE_EXPR_RE.test(t)) return evalRef(t, ctx, warn);
  throw new Error(`expressao invalida: "${expr}" (use um caminho como steps.a.result)`);
}

/** Percorre uma estrutura e devolve os caminhos referenciados dentro de {{ }} (validacao estatica). */
export function templatePaths(value: unknown, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof value === 'string') {
    const out: string[] = [];
    for (const m of value.matchAll(TEMPLATE_RE)) out.push(m[1].split('|')[0].trim());
    return out;
  }
  if (Array.isArray(value)) return value.flatMap((v) => templatePaths(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.values(value).flatMap((v) => templatePaths(v, depth + 1));
  return [];
}

// ---------------------------------------------------------------- condicoes

type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'path'; p: string }
  | { k: 'not'; e: Node }
  | { k: 'and' | 'or'; l: Node; r: Node }
  | { k: 'cmp'; op: string; l: Node; r: Node };

type Token = { t: 'op' | 'str' | 'num' | 'id'; v: string };

const TOKEN_RE = new RegExp(
  `\\s*(?:(&&|\\|\\||==|!=|>=|<=|>|<|!|\\(|\\))|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|(-?\\d+(?:\\.\\d+)?)|(${PATH_SRC}))`,
  'y',
);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m)
      throw new Error(`condicao invalida perto de "${src.slice(pos, pos + 12).trim()}": ${src}`);
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'op', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'str', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'num', v: m[3] });
    else out.push({ t: 'id', v: m[4] });
  }
  return out;
}

/** Aceita {{ }} ao redor dos caminhos (o modelo costuma escrever assim). */
function normalizeCondition(expr: string): string {
  return expr.replace(TEMPLATE_RE, (_m, inner: string) => ` ${inner.split('|')[0].trim()} `);
}

export function parseCondition(expr: string): Node {
  if (typeof expr !== 'string' || !expr.trim()) throw new Error('condicao vazia');
  if (expr.length > MAX_EXPR) throw new Error(`condicao passa de ${MAX_EXPR} caracteres`);
  const tokens = tokenize(normalizeCondition(expr));
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;

  const operand = (): Node => {
    const tok = tokens[i++];
    if (!tok) throw new Error(`condicao incompleta: ${expr}`);
    if (tok.t === 'op' && tok.v === '(') {
      const e = or();
      if (!isOp(')')) throw new Error(`falta ")" na condicao: ${expr}`);
      i++;
      return e;
    }
    if (tok.t === 'str') {
      const body = tok.v.slice(1, -1);
      return {
        k: 'lit',
        v: tok.v[0] === '"' ? (JSON.parse(tok.v) as string) : body.replace(/\\(.)/g, '$1'),
      };
    }
    if (tok.t === 'num') return { k: 'lit', v: Number(tok.v) };
    if (tok.t === 'id') {
      if (tok.v === 'true') return { k: 'lit', v: true };
      if (tok.v === 'false') return { k: 'lit', v: false };
      if (tok.v === 'null') return { k: 'lit', v: null };
      return { k: 'path', p: tok.v };
    }
    throw new Error(`condicao invalida perto de "${tok.v}": ${expr}`);
  };
  const cmp = (): Node => {
    const l = operand();
    const tok = peek();
    if (
      tok &&
      ((tok.t === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(tok.v)) ||
        (tok.t === 'id' && tok.v === 'contains'))
    ) {
      i++;
      return { k: 'cmp', op: tok.v, l, r: operand() };
    }
    return l;
  };
  const not = (): Node => {
    if (isOp('!')) {
      i++;
      return { k: 'not', e: not() };
    }
    return cmp();
  };
  const and = (): Node => {
    let l = not();
    while (isOp('&&')) {
      i++;
      l = { k: 'and', l, r: not() };
    }
    return l;
  };
  const or = (): Node => {
    let l = and();
    while (isOp('||')) {
      i++;
      l = { k: 'or', l, r: and() };
    }
    return l;
  };

  const ast = or();
  if (i < tokens.length) throw new Error(`condicao invalida perto de "${tokens[i].v}": ${expr}`);
  return ast;
}

export function conditionPaths(expr: string): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    if (n.k === 'path') out.push(n.p);
    else if (n.k === 'not') walk(n.e);
    else if (n.k === 'and' || n.k === 'or' || n.k === 'cmp') {
      walk(n.l);
      walk(n.r);
    }
  };
  walk(parseCondition(expr));
  return out;
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function looseEq(a: unknown, b: unknown): boolean {
  if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  if (typeof a === typeof b) return a === b;
  const num = (x: unknown) =>
    typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b);
  return String(a) === String(b);
}

function order(op: string, a: unknown, b: unknown): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  let x: number | string;
  let y: number | string;
  if (typeof a === 'string' && typeof b === 'string') {
    x = a;
    y = b;
  } else {
    x = Number(a);
    y = Number(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
  }
  return op === '>' ? x > y : op === '>=' ? x >= y : op === '<' ? x < y : x <= y;
}

function evalNode(n: Node, ctx: Ctx): unknown {
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'path':
      return getPath(ctx, n.p);
    case 'not':
      return !truthy(evalNode(n.e, ctx));
    case 'and':
      return truthy(evalNode(n.l, ctx)) && truthy(evalNode(n.r, ctx));
    case 'or':
      return truthy(evalNode(n.l, ctx)) || truthy(evalNode(n.r, ctx));
    case 'cmp': {
      const a = evalNode(n.l, ctx);
      const b = evalNode(n.r, ctx);
      if (n.op === '==') return looseEq(a, b);
      if (n.op === '!=') return !looseEq(a, b);
      if (n.op === 'contains') {
        if (Array.isArray(a)) return a.some((x) => looseEq(x, b));
        if (typeof a === 'string' && b !== undefined && b !== null)
          return a.toLowerCase().includes(stringify(b).toLowerCase());
        return false;
      }
      return order(n.op, a, b);
    }
  }
}

export function evalCondition(expr: string, ctx: Ctx): boolean {
  return truthy(evalNode(parseCondition(expr), ctx));
}
