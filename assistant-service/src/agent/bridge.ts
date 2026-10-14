import {
  ASSISTANT_LIMITS,
  type AssistantEvent,
  type BrowserAction,
  type PageContext,
  type ToolResult,
} from "../../../src/lib/assistant/protocol";

export type EventSink = (event: AssistantEvent) => void;

interface Pending {
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RunLimitError extends Error {}

/** One assistant run: its event stream, its pending browser requests and its limits. */
export class AssistantRun {
  readonly startedAt = Date.now();
  actions = 0;
  cancelled = false;
  private sink: EventSink | null = null;
  private readonly pending = new Map<string, Pending>();
  private callCounter = 0;
  private abortHandlers: Array<() => void> = [];
  private deadline: NodeJS.Timeout | null = null;
  steer?: (text: string) => Promise<unknown>;

  constructor(
    readonly id: string,
    readonly userId: string,
    readonly workspaceId: string,
    readonly context: PageContext
  ) {}

  attachSink(sink: EventSink) {
    this.sink = sink;
  }

  emit(event: AssistantEvent) {
    if (!this.sink) return;
    try {
      this.sink(event);
    } catch {
      // The browser went away; the run is cancelled by the stream's close handler.
    }
  }

  /** Cancel the run when it exceeds its wall-clock limit. */
  startDeadline(onTimeout: () => void) {
    this.deadline = setTimeout(() => {
      this.emit({ type: "error", message: "The assistant took too long and was stopped." });
      onTimeout();
    }, ASSISTANT_LIMITS.maxRunMs);
    this.deadline.unref?.();
  }

  onAbort(handler: () => void) {
    this.abortHandlers.push(handler);
  }

  nextCallId(): string {
    this.callCounter += 1;
    return `${this.id}:${this.callCounter}`;
  }

  /** Ask the browser to do something and wait for its answer. */
  request(action: BrowserAction, timeoutMs: number = ASSISTANT_LIMITS.actionTimeoutMs): Promise<ToolResult> {
    if (this.cancelled) return Promise.reject(new Error("The run was cancelled"));
    if (this.actions >= ASSISTANT_LIMITS.maxActionsPerRun) {
      return Promise.reject(new RunLimitError("Action limit reached for this request. Stop and tell the user what is done."));
    }
    this.actions += 1;
    const callId = this.nextCallId();
    return this.waitFor(callId, timeoutMs, () => this.emit({ type: "browser_action", callId, action }));
  }

  /** Show a confirmation card and wait for the user's answer. */
  confirm(event: Extract<AssistantEvent, { type: "confirmation" }>): Promise<ToolResult> {
    if (this.cancelled) return Promise.reject(new Error("The run was cancelled"));
    return this.waitFor(event.callId, ASSISTANT_LIMITS.confirmationTimeoutMs, () => this.emit(event));
  }

  private waitFor(callId: string, timeoutMs: number, send: () => void): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error("The browser did not answer in time"));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(callId, { resolve, reject, timer });
      send();
    });
  }

  /** Called when the browser posts a tool result. Returns false for an unknown call. */
  resolve(result: ToolResult): boolean {
    const pending = this.pending.get(result.callId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(result.callId);
    pending.resolve(result);
    return true;
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const [callId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The run was cancelled"));
      this.pending.delete(callId);
    }
    for (const handler of this.abortHandlers) {
      try {
        handler();
      } catch {
        // best effort
      }
    }
  }

  dispose() {
    if (this.deadline) clearTimeout(this.deadline);
    this.cancel();
    this.sink = null;
  }
}

/** Tracks live runs. One active run per user. */
export class RunRegistry {
  private readonly runs = new Map<string, AssistantRun>();

  create(params: { id: string; userId: string; workspaceId: string; context: PageContext }): AssistantRun {
    if (this.runs.has(params.id)) throw new RunLimitError("Duplicate run id");
    if (this.activeForUser(params.userId)) throw new RunLimitError("A run is already active for this user");
    const run = new AssistantRun(params.id, params.userId, params.workspaceId, params.context);
    this.runs.set(run.id, run);
    return run;
  }

  get(id: string): AssistantRun | undefined {
    return this.runs.get(id);
  }

  activeForUser(userId: string): AssistantRun | undefined {
    for (const run of this.runs.values()) if (run.userId === userId) return run;
    return undefined;
  }

  remove(id: string) {
    const run = this.runs.get(id);
    if (!run) return;
    run.dispose();
    this.runs.delete(id);
  }

  get size() {
    return this.runs.size;
  }
}
