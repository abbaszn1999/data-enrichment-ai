import { randomUUID } from "node:crypto";
import {
  STORE_AGENT_LIMITS,
  type QuestionItem,
  type StartRunRequest,
  type StoreAgentEvent,
  type StoreAgentEventInput,
} from "../../../src/lib/store-agent/protocol";

type Listener = (event: StoreAgentEvent) => void;

interface Waiter<T> {
  resolve: (value: T) => void;
  timer: NodeJS.Timeout;
}

/** "superseded": the user wrote in the chat instead of deciding. */
export type ApprovalOutcome = "approved" | "rejected" | "expired" | "superseded";

/** The answers from the card, what the user wrote in the chat instead, or null when nobody answered. */
export type QuestionReply = string[][] | { message: string } | null;

/**
 * One live Store Agent run. It outlives the browser connection: events are
 * buffered with a sequence number so a page that reconnects (refresh, a second
 * tab, coming back later) replays what it missed and follows from there.
 */
export class StoreAgentRun {
  readonly startedAt = Date.now();
  cancelled = false;
  finished = false;
  steer?: (text: string) => Promise<unknown>;

  private seq = 0;
  /** Messages the user sent while the run works, not yet known to have reached the agent. */
  private guidance: Array<{ id: number; text: string }> = [];
  private guidanceId = 0;
  private readonly events: StoreAgentEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly approvals = new Map<string, Waiter<ApprovalOutcome>>();
  private readonly questions = new Map<string, Waiter<QuestionReply>>();
  /** What the user wrote instead of deciding, per approval set aside. */
  private readonly chatReplies = new Map<string, string>();
  private readonly abortHandlers: Array<() => void> = [];
  private readonly controller = new AbortController();

  constructor(readonly request: StartRunRequest) {}

  /**
   * The user wrote while the agent works ("stop", "only the black ones").
   * The SDK's steer may deliver it into the current turn, or may hand it back
   * to be sent after the turn, which can be too late. So it is also queued:
   * the agent's next tool call returns it instead of running, and if the turn
   * ends first it is sent as a follow-up. Returns the queue id.
   */
  addGuidance(text: string): number {
    const id = ++this.guidanceId;
    this.guidance.push({ id, text });
    return id;
  }

  /** The SDK confirmed the agent has this message: no need to repeat it. */
  guidanceDelivered(id: number) {
    this.guidance = this.guidance.filter((g) => g.id !== id);
  }

  /** Take every message the agent has not seen yet. */
  takeGuidance(): string[] {
    const texts = this.guidance.map((g) => g.text);
    this.guidance = [];
    return texts;
  }

  get id() {
    return this.request.runId;
  }
  get chatId() {
    return this.request.chatId;
  }
  get workspaceId() {
    return this.request.workspaceId;
  }
  get userId() {
    return this.request.userId;
  }
  /** Aborted when the run is cancelled; pass to long tool calls. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  get lastSeq() {
    return this.seq;
  }

  emit(input: StoreAgentEventInput): StoreAgentEvent {
    this.seq += 1;
    const event = { ...input, seq: this.seq } as StoreAgentEvent;
    // Pings keep proxies open; they are not worth replaying.
    if (event.type !== "ping") this.events.push(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // a closed connection; its stream cleans up
      }
    }
    return event;
  }

  /** Replay events after `afterSeq`, then follow new ones. Returns the unsubscribe. */
  subscribe(listener: Listener, afterSeq = 0): () => void {
    for (const event of this.events) if (event.seq > afterSeq) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get history(): readonly StoreAgentEvent[] {
    return this.events;
  }

  /** Wait for the user to approve a store change. Expires after the wait limit. */
  waitForApproval(approvalId: string): Promise<ApprovalOutcome> {
    if (this.cancelled) return Promise.resolve("rejected");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(approvalId);
        resolve("expired");
      }, STORE_AGENT_LIMITS.maxWaitMs);
      timer.unref?.();
      this.approvals.set(approvalId, { resolve, timer });
    });
  }

  decide(approvalId: string, approve: boolean): boolean {
    const waiter = this.approvals.get(approvalId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.approvals.delete(approvalId);
    waiter.resolve(approve ? "approved" : "rejected");
    return true;
  }

  /** Ask the user one card of questions and wait. Resolves null when nobody answers in time. */
  ask(questions: QuestionItem[]): { questionId: string; answer: Promise<QuestionReply> } {
    const questionId = randomUUID();
    const answer = new Promise<QuestionReply>((resolve) => {
      if (this.cancelled) return resolve(null);
      const timer = setTimeout(() => {
        this.questions.delete(questionId);
        resolve(null);
      }, STORE_AGENT_LIMITS.maxWaitMs);
      timer.unref?.();
      this.questions.set(questionId, { resolve, timer });
    });
    this.emit({ type: "question", questionId, questions });
    return { questionId, answer };
  }

  answer(questionId: string, answers: string[][]): boolean {
    const waiter = this.questions.get(questionId);
    if (!waiter) return false;
    clearTimeout(waiter.timer);
    this.questions.delete(questionId);
    waiter.resolve(answers);
    this.emit({ type: "question_resolved", questionId, answers });
    return true;
  }

  /**
   * The user wrote in the chat while a question or approval card waited. The
   * agent is blocked on that card, so a queued message would never reach it:
   * the message answers the card instead (an approval is set aside, not made).
   * Returns false when no card was waiting.
   */
  replyInChat(text: string): boolean {
    if (!this.questions.size && !this.approvals.size) return false;
    for (const [questionId, waiter] of this.questions) {
      clearTimeout(waiter.timer);
      waiter.resolve({ message: text });
      this.emit({ type: "question_resolved", questionId, answers: [], inChat: true });
    }
    this.questions.clear();
    for (const [approvalId, waiter] of this.approvals) {
      clearTimeout(waiter.timer);
      this.chatReplies.set(approvalId, text);
      waiter.resolve("superseded");
    }
    this.approvals.clear();
    return true;
  }

  /** What the user wrote instead of deciding on this approval. */
  takeChatReply(approvalId: string): string | undefined {
    const text = this.chatReplies.get(approvalId);
    this.chatReplies.delete(approvalId);
    return text;
  }

  /** True while the run is paused on the user. */
  get waitingOnUser(): "approval" | "question" | null {
    if (this.approvals.size) return "approval";
    if (this.questions.size) return "question";
    return null;
  }

  onAbort(handler: () => void) {
    this.abortHandlers.push(handler);
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.controller.abort();
    for (const [, waiter] of this.approvals) {
      clearTimeout(waiter.timer);
      waiter.resolve("rejected");
    }
    this.approvals.clear();
    for (const [, waiter] of this.questions) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.questions.clear();
    for (const handler of this.abortHandlers) {
      try {
        handler();
      } catch {
        // best effort
      }
    }
  }
}

export class StoreAgentBusyError extends Error {}

/** Live runs, at most one per chat and a few per workspace. */
export class StoreAgentRegistry {
  private readonly runs = new Map<string, StoreAgentRun>();
  /** Finished runs stay reachable briefly so a late reconnect still gets the ending. */
  private readonly recent = new Map<string, { run: StoreAgentRun; until: number }>();

  create(request: StartRunRequest): StoreAgentRun {
    this.sweep();
    if (this.runs.has(request.runId)) throw new StoreAgentBusyError("Duplicate run id");
    for (const run of this.runs.values()) {
      if (run.chatId === request.chatId) throw new StoreAgentBusyError("This chat is already working");
    }
    const inWorkspace = [...this.runs.values()].filter((r) => r.workspaceId === request.workspaceId).length;
    if (inWorkspace >= STORE_AGENT_LIMITS.maxConcurrentRunsPerWorkspace) {
      throw new StoreAgentBusyError("Too many chats are working in this workspace at once");
    }
    const run = new StoreAgentRun(request);
    this.runs.set(run.id, run);
    return run;
  }

  get(runId: string): StoreAgentRun | undefined {
    return this.runs.get(runId) ?? this.recent.get(runId)?.run;
  }

  forChat(chatId: string): StoreAgentRun | undefined {
    for (const run of this.runs.values()) if (run.chatId === chatId) return run;
    return undefined;
  }

  finish(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.finished = true;
    this.runs.delete(runId);
    this.recent.set(runId, { run, until: Date.now() + 5 * 60 * 1000 });
  }

  get live(): StoreAgentRun[] {
    return [...this.runs.values()];
  }

  private sweep() {
    const now = Date.now();
    for (const [id, entry] of this.recent) if (entry.until < now) this.recent.delete(id);
  }
}
