/** Dev-friendly gallery logs for the Next.js terminal. */

const PREFIX = "[gallery]";

function safeJson(value: unknown, max = 4000): string {
  try {
    const sensitiveKeys = new Set([
      "inputtext",
      "outputtext",
      "productrow",
      "rowdata",
      "searchquery",
      "queries",
      "url",
      "imageurl",
      "pageurl",
      "originalimageuri",
      "productidentity",
      "api_key",
      "apikey",
    ]);
    const text = JSON.stringify(
      value,
      (key, item) => {
        if (!sensitiveKeys.has(key.toLowerCase())) return item;
        if (typeof item === "string" && /^https?:\/\//i.test(item)) {
          try {
            return `[redacted-url:${new URL(item).hostname}]`;
          } catch {
            return "[redacted-url]";
          }
        }
        return "[redacted]";
      },
      2
    ).replace(/https?:\/\/[^\s"\\]+/gi, "[redacted-url]");
    if (text.length <= max) return text;
    return `${text.slice(0, max)}\n… truncated (${text.length} chars)`;
  } catch {
    return String(value);
  }
}

export function galleryLog(step: string, message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`${PREFIX} ${step} — ${message}`);
    return;
  }
  console.log(`${PREFIX} ${step} — ${message}\n${safeJson(data)}`);
}

export function galleryVerboseLog(step: string, message: string, data?: unknown) {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.GALLERY_VERBOSE_LOGS !== "1"
  ) {
    return;
  }
  galleryLog(step, message, data);
}

export function galleryWarn(step: string, message: string, data?: unknown) {
  if (data === undefined) {
    console.warn(`${PREFIX} ${step} — ${message}`);
    return;
  }
  console.warn(`${PREFIX} ${step} — ${message}\n${safeJson(data)}`);
}

export function galleryError(step: string, message: string, err?: unknown) {
  const record =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const cause =
    record?.cause && typeof record.cause === "object"
      ? (record.cause as Record<string, unknown>)
      : null;
  const detail = record
    ? {
        name: record.name,
        message: record.message,
        code: record.code,
        cause: cause
          ? { name: cause.name, message: cause.message, code: cause.code }
          : undefined,
      }
    : err;
  console.error(`${PREFIX} ${step} — ${message}\n${safeJson(detail)}`);
}

/** In-memory stage trail for one gallery Google row (printed at end). */
export class GalleryPipelineTrace {
  private readonly startedAt = Date.now();
  private path: "lens-first" | "images-then-lens" | "unknown" = "unknown";
  private readonly stages: Array<{
    stage: string;
    message: string;
    ms: number;
    data?: unknown;
  }> = [];

  constructor(private readonly rowId: string) {
    galleryLog("pipeline:start", `Row ${rowId}`);
  }

  setPath(path: "lens-first" | "images-then-lens") {
    this.path = path;
    galleryLog("pipeline:path", `Selected ${path}`, { rowId: this.rowId });
  }

  stage(stage: string, message: string, data?: unknown) {
    const entry = {
      stage,
      message,
      ms: Date.now() - this.startedAt,
      data,
    };
    this.stages.push(entry);
    galleryLog(`pipeline:${stage}`, message, {
      rowId: this.rowId,
      elapsedMs: entry.ms,
      ...(data && typeof data === "object" ? (data as object) : { detail: data }),
    });
  }

  finish(outcome: "ready" | "failed", data?: unknown) {
    galleryLog("pipeline:done", `Row ${this.rowId} → ${outcome}`, {
      path: this.path,
      totalMs: Date.now() - this.startedAt,
      stages: this.stages.map(({ stage, message, ms }) => ({
        stage,
        message,
        ms,
      })),
      ...(data && typeof data === "object" ? (data as object) : { detail: data }),
    });
  }
}
