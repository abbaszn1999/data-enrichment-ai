const SENSITIVE_KEY =
  /^(config|admin_api_token|application_password|authorization|password|secret|token|apikey|api_key)$/i;

const SENSITIVE_SUBSTRING =
  /shpat_[a-zA-Z0-9]+|sk_live_[a-zA-Z0-9]+|Bearer\s+[A-Za-z0-9._-]+/g;

export function scrubValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") {
    return value.replace(SENSITIVE_SUBSTRING, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[childKey] = scrubValue(childValue, childKey);
    }
    return out;
  }
  return value;
}

export function scrubSentryEvent<T extends { extra?: unknown; request?: unknown; contexts?: unknown }>(
  event: T
): T {
  return scrubValue(event) as T;
}
