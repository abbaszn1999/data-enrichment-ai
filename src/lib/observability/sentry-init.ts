import { scrubSentryEvent } from "./scrub";

/**
 * Sentry is initialised only when a DSN is present AND `@sentry/nextjs`
 * is installed. Structured `[metric]` logs still emit without it (P0-9
 * counters). Install with `npm install @sentry/nextjs` then set
 * `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
 */
export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  try {
    const specifier = "@sentry/" + "nextjs";
    const Sentry = (await import(specifier)) as {
      init: (options: Record<string, unknown>) => void;
    };
    Sentry.init({
      dsn,
      enabled: true,
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
      beforeSend(event: unknown) {
        return scrubSentryEvent(event as { extra?: unknown });
      },
    });
  } catch (error) {
    console.warn(
      "[observability] Sentry SDK not available; continuing with structured logs only",
      error instanceof Error ? error.message : error
    );
  }
}
