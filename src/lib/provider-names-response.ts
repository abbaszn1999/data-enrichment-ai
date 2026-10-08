import { hideProviderNames } from "./provider-names";

/** Only error fields: content fields may legitimately contain these words (e.g. a product name). */
const ERROR_KEYS = new Set(["error", "errorMessage", "error_message"]);

function scrubErrorValue(value: unknown): unknown {
  if (typeof value === "string") return hideProviderNames(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      const shown = hideProviderNames(message);
      return shown === message ? value : { ...value, message: shown };
    }
  }
  return value;
}

/** Hides provider names in the top-level error fields of a JSON response body. */
export function scrubErrorFields<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!ERROR_KEYS.has(key)) continue;
    const shown = scrubErrorValue(value);
    if (shown !== value) {
      out ??= { ...(body as Record<string, unknown>) };
      out[key] = shown;
    }
  }
  return (out ?? body) as T;
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
