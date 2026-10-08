import { hideProviderNames } from "./provider-names";

/** Only error fields: content fields may legitimately contain these words (e.g. a product name). */
const ERROR_KEYS = new Set([
  "error",
  "errorMessage",
  "error_message",
  "lastError",
  "last_error",
  "warning",
  "warnings",
  "reason",
  "failureReason",
]);
const MAX_DEPTH = 8;

function scrubErrorValue(value: unknown): unknown {
  if (typeof value === "string") return hideProviderNames(value);
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    value.forEach((item, i) => {
      const shown = typeof item === "string" ? hideProviderNames(item) : item;
      if (shown !== item) {
        out ??= [...value];
        out[i] = shown;
      }
    });
    return out ?? value;
  }
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      const shown = hideProviderNames(message);
      return shown === message ? value : { ...value, message: shown };
    }
  }
  return value;
}

function walk(value: unknown, depth: number): unknown {
  if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const shown = walk(value[i], depth + 1);
      if (shown !== value[i]) {
        out ??= [...value];
        out[i] = shown;
      }
    }
    return out ?? value;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  let out: Record<string, unknown> | null = null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const shown = ERROR_KEYS.has(key) ? scrubErrorValue(child) : walk(child, depth + 1);
    if (shown !== child) {
      out ??= { ...(value as Record<string, unknown>) };
      out[key] = shown;
    }
  }
  return out ?? value;
}

/** Hides provider names in error fields anywhere in a JSON response body. */
export function scrubErrorFields<T>(body: T): T {
  return walk(body, 0) as T;
}

const INSTALLED = Symbol.for("autommerce.providerNameScrubber");

/**
 * Route handlers return `{ error: err.message }` in many places, and SDK errors
 * name the provider. NextResponse.json goes through the global Response.json,
 * so wrapping it once covers every JSON route.
 */
export function installProviderNameScrubber(): void {
  const holder = Response as unknown as Record<symbol, boolean> & {
    json: (body: unknown, init?: ResponseInit) => Response;
  };
  if (holder[INSTALLED]) return;
  const original = holder.json.bind(Response);
  holder.json = (body: unknown, init?: ResponseInit) => original(scrubErrorFields(body), init);
  holder[INSTALLED] = true;
}
