const PREFIX = "[visualizer]";

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function visualizerLog(
  step: string,
  message: string,
  data?: unknown
): void {
  if (data === undefined) {
    console.log(`${PREFIX} ${step} — ${message}`);
    return;
  }
  console.log(`${PREFIX} ${step} — ${message}\n${safeJson(data)}`);
}

export function visualizerWarn(
  step: string,
  message: string,
  data?: unknown
): void {
  if (data === undefined) {
    console.warn(`${PREFIX} ${step} — ${message}`);
    return;
  }
  console.warn(`${PREFIX} ${step} — ${message}\n${safeJson(data)}`);
}

export function visualizerError(
  step: string,
  message: string,
  error?: unknown
): void {
  const detail =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : error;
  console.error(`${PREFIX} ${step} — ${message}\n${safeJson(detail)}`);
}
