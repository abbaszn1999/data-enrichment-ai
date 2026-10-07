/**
 * Static guard for AI-generated JavaScript function bodies (SEC-02 / SEC-15).
 *
 * This is defense in depth, NOT a full sandbox: it rejects bodies that mention
 * globals, module loaders, prototype escapes or network/DOM APIs, and bodies
 * that try to build property names dynamically. Row transforms only need plain
 * string/number/array operations on `row`.
 */

const FORBIDDEN_IDENTIFIERS = [
  "process",
  "require",
  "module",
  "exports",
  "import",
  "eval",
  "Function",
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "globalThis",
  "global",
  "window",
  "self",
  "document",
  "this",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cookie",
  "navigator",
  "location",
  "Reflect",
  "Proxy",
  "Buffer",
  "child_process",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "Atomics",
  "WebAssembly",
  "async",
  "await",
  "yield",
  "with",
  "getPrototypeOf",
  "setPrototypeOf",
  "defineProperty",
  "getOwnPropertyDescriptor",
];

const FORBIDDEN_RE = new RegExp(`(?<![\\w$])(?:${FORBIDDEN_IDENTIFIERS.join("|")})(?![\\w$])`);

// Property names built at runtime: obj["a"+"b"], obj[`${x}`], obj[fn()]
const DYNAMIC_SUBSCRIPT_RE =
  /\[[^\]]*(?:["'`][^\]]*\+|\+[^\]]*["'`]|\$\{|\.concat|\.join|fromCharCode|atob)[^\]]*\]/;

// Literal + literal concatenation is the usual way to smuggle a blocked name
const LITERAL_CONCAT_RE = /(["'`])\s*\+\s*["'`]/;

// Unicode / hex escapes can hide identifiers (e.g. \u0070rocess)
const ESCAPE_RE = /\\u[0-9a-fA-F{]|\\x[0-9a-fA-F]{2}/;

// Plain "..." / '...' literals (column names, text). Template literals stay as code.
const STRING_LITERAL_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

// Property names that reach the Function constructor even from a literal subscript
const FORBIDDEN_LITERAL_RE =
  /(?<![\w$])(?:constructor|prototype|__proto__|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)(?![\w$])/;

export const MAX_FUNCTION_BODY_LENGTH = 8_000;

export function checkFunctionBodySafety(body: unknown): string | null {
  if (typeof body !== "string" || !body.trim()) return "Function body is empty";
  if (body.length > MAX_FUNCTION_BODY_LENGTH) return "Function body is too long";
  if (ESCAPE_RE.test(body)) return "Function body contains disallowed escape sequences";
  const literals = body.match(STRING_LITERAL_RE) ?? [];
  const badLiteral = literals.find((s) => FORBIDDEN_LITERAL_RE.test(s));
  if (badLiteral) return `Function body uses a disallowed property name: ${badLiteral}`;
  const code = body.replace(STRING_LITERAL_RE, '""');
  const hit = code.match(FORBIDDEN_RE);
  if (hit) return `Function body uses a disallowed construct: ${hit[0]}`;
  if (DYNAMIC_SUBSCRIPT_RE.test(body) || LITERAL_CONCAT_RE.test(body)) {
    return "Function body builds property names dynamically, which is not allowed";
  }
  return null;
}

/** Throws if the body is unsafe; otherwise compiles it. */
export function compileSafeRowFunction<T extends (...args: never[]) => unknown>(
  body: string,
  argName = "row"
): T {
  const problem = checkFunctionBodySafety(body);
  if (problem) throw new Error(problem);
  return new Function(argName, body) as unknown as T;
}
