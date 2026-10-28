import type {
  LocalAgentDocument,
  LocalAgentRunDocument,
  LocalAgentRunEventDocument,
  LocalAgentStore,
} from "@cursor/sdk";

/**
 * Durable persistence behind {@link WriteBehindAgentStore}. The Supabase
 * implementation lives in ./supabase-backend.ts; tests use an in-memory one.
 */
export interface AgentStoreBackend {
  loadAgent(agentId: string): Promise<LocalAgentDocument | null>;
  listAgents(filter: { cwd?: string; limit: number; afterUpdatedAt?: number }): Promise<LocalAgentDocument[]>;
  saveAgents(agents: readonly LocalAgentDocument[]): Promise<void>;
  deleteAgents(agentIds: readonly string[]): Promise<void>;

  loadRuns(agentId: string): Promise<LocalAgentRunDocument[]>;
  saveRuns(runs: readonly LocalAgentRunDocument[]): Promise<void>;
  deleteRuns(runIds: readonly string[]): Promise<void>;

  /** Highest stored seq for a run, or 0. */
  lastEventSeq(runId: string): Promise<number>;
  loadEvents(runId: string, afterSeq: number, limit: number): Promise<LocalAgentRunEventDocument[]>;
  saveEvents(events: readonly LocalAgentRunEventDocument[]): Promise<void>;
  deleteEvents(runIds: readonly string[]): Promise<void>;

  loadBlob(agentId: string, blobId: string): Promise<Uint8Array | null>;
  /** Every stored blob of an agent, in as few requests as possible. */
  loadAllBlobs(agentId: string): Promise<Map<string, Uint8Array>>;
  saveBlobs(blobs: ReadonlyArray<{ agentId: string; blobId: string; data: Uint8Array }>): Promise<void>;
  listBlobs(agentId: string): Promise<string[]>;
  deleteBlobs(agentId: string, blobIds: readonly string[]): Promise<void>;
}

type Log = (message: string, extra?: unknown) => void;

const key = (agentId: string, blobId: string) => `${agentId}\u0000${blobId}`;
const DEFAULT_LIMIT = 100;

/**
 * The SDK's local agent store, held in memory and persisted in the background.
 *
 * The SDK writes after every streamed token and waits for each write, so a
 * store that went to the network on every call would slow the reply to a
 * crawl. Writes land in memory and return at once; {@link flush} sends
 * everything that changed in one batch. The runner calls it at natural
 * checkpoints (a tool finished, the reply ended), on a timer during long
 * turns, and on shutdown.
 *
 * Reads fall through to the backend when the data is not in memory, so a chat
 * can be resumed on a fresh process. {@link evictAgent} drops an idle agent's
 * data from memory once it is persisted.
 */
export class WriteBehindAgentStore implements LocalAgentStore {
  private readonly agentDocs = new Map<string, LocalAgentDocument>();
  private readonly runDocs = new Map<string, LocalAgentRunDocument>();
  /** Agents whose runs have been read from the backend. */
  private readonly runsHydrated = new Set<string>();
  private readonly blobs = new Map<string, Uint8Array>();
  /** One full blob load per agent while it is in memory. */
  private readonly blobPrefetch = new Map<string, Promise<void>>();
  private readonly events = new Map<string, LocalAgentRunEventDocument[]>();
  /** Highest seq known per run (memory or backend). */
  private readonly lastSeq = new Map<string, number>();

  private readonly dirtyAgents = new Set<string>();
  private readonly dirtyRuns = new Set<string>();
  private readonly dirtyBlobs = new Set<string>();
  /** Events appended since the last flush, in order. */
  private pendingEvents: LocalAgentRunEventDocument[] = [];
  /** Blobs the SDK pruned, removed from the backend once the newer state is saved. */
  private readonly pendingBlobDeletes = new Set<string>();

  private flushing: Promise<void> | null = null;
  private flushAgain = false;

  constructor(
    private readonly backend: AgentStoreBackend,
    private readonly log: Log = () => {}
  ) {}

  /** True when something changed since the last successful flush. */
  get isDirty(): boolean {
    return this.dirtyAgents.size + this.dirtyRuns.size + this.dirtyBlobs.size + this.pendingEvents.length + this.pendingBlobDeletes.size > 0;
  }

  // ─── agents ────────────────────────────────────────────────────────────────

  readonly agents: LocalAgentStore["agents"] = {
    get: async ({ agentId }) => {
      const cached = this.agentDocs.get(agentId);
      if (cached) return cached;
      const loaded = await this.backend.loadAgent(agentId);
      if (loaded && !this.agentDocs.has(agentId)) this.agentDocs.set(agentId, loaded);
      return this.agentDocs.get(agentId) ?? null;
    },
    create: async ({ agent }) => {
      this.agentDocs.set(agent.agentId, agent);
      this.dirtyAgents.add(agent.agentId);
      return agent;
    },
    update: async ({ agent }) => {
      this.agentDocs.set(agent.agentId, agent);
      this.dirtyAgents.add(agent.agentId);
      return agent;
    },
    delete: async ({ filter }) => {
      const ids = filter.agentIds?.length
        ? [...filter.agentIds]
        : [...this.agentDocs.values()].filter((a) => !filter.cwd || a.cwd === filter.cwd).map((a) => a.agentId);
      await this.deleteAgentsEverywhere(ids);
    },
    list: async (input) => {
      const filter = input?.filter ?? {};
      const limit = filter.limit ?? DEFAULT_LIMIT;
      const after = filter.cursor ? decodeCursor(filter.cursor) : undefined;
      const stored = await this.backend.listAgents({ cwd: filter.cwd, limit: limit + 1, afterUpdatedAt: after?.updatedAt });
      const merged = new Map(stored.map((a) => [a.agentId, a]));
      for (const doc of this.agentDocs.values()) if (!filter.cwd || doc.cwd === filter.cwd) merged.set(doc.agentId, doc);
      const sorted = [...merged.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt || (a.agentId < b.agentId ? 1 : -1))
        .filter((a) => !after || a.updatedAt < after.updatedAt || (a.updatedAt === after.updatedAt && a.agentId < after.agentId));
      const items = sorted.slice(0, limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor: sorted.length > limit && last ? encodeCursor({ updatedAt: last.updatedAt, agentId: last.agentId }) : undefined,
      };
    },
  };

  // ─── runs ──────────────────────────────────────────────────────────────────

  private async hydrateRuns(agentId: string): Promise<void> {
    if (this.runsHydrated.has(agentId)) return;
    const loaded = await this.backend.loadRuns(agentId);
    for (const run of loaded) if (!this.runDocs.has(run.runId)) this.runDocs.set(run.runId, run);
    this.runsHydrated.add(agentId);
  }

  readonly runs: LocalAgentStore["runs"] = {
    get: async ({ agentId, runId }) => {
      const cached = this.runDocs.get(runId);
      if (cached) return cached.agentId === agentId ? cached : null;
      await this.hydrateRuns(agentId);
      const run = this.runDocs.get(runId);
      return run && run.agentId === agentId ? run : null;
    },
    create: async ({ run }) => {
      this.runDocs.set(run.runId, run);
      this.dirtyRuns.add(run.runId);
      return run;
    },
    update: async ({ run }) => {
      this.runDocs.set(run.runId, run);
      this.dirtyRuns.add(run.runId);
      return run;
    },
    delete: async ({ filter }) => {
      for (const agentId of filter.agentIds ?? []) await this.hydrateRuns(agentId);
      const ids = [...this.runDocs.values()]
        .filter((r) => {
          const byAgent = !filter.agentIds?.length || filter.agentIds.includes(r.agentId);
          const byRun = !filter.runIds?.length || filter.runIds.includes(r.runId);
          return byAgent && byRun;
        })
        .map((r) => r.runId);
      for (const id of filter.runIds ?? []) if (!ids.includes(id)) ids.push(id);
      await this.deleteRunsEverywhere(ids);
    },
    list: async (input) => {
      const filter = input?.filter ?? {};
      for (const agentId of filter.agentIds ?? []) await this.hydrateRuns(agentId);
      const limit = filter.limit ?? DEFAULT_LIMIT;
      const sorted = [...this.runDocs.values()]
        .filter((r) => {
          const byAgent = !filter.agentIds?.length || filter.agentIds.includes(r.agentId);
          const byRun = !filter.runIds?.length || filter.runIds.includes(r.runId);
          return byAgent && byRun;
        })
        .sort((a, b) => a.turnNumber - b.turnNumber || (a.runId < b.runId ? -1 : 1));
      const start = filter.cursor ? sorted.findIndex((r) => r.runId === filter.cursor) + 1 : 0;
      const items = sorted.slice(start, start + limit);
      const last = items[items.length - 1];
      return { items, nextCursor: start + limit < sorted.length && last ? last.runId : undefined };
    },
  };

  // ─── run events ────────────────────────────────────────────────────────────

  readonly runEvents: LocalAgentStore["runEvents"] = {
    append: async (input) => {
      let seq = this.lastSeq.get(input.runId);
      if (seq === undefined) seq = await this.backend.lastEventSeq(input.runId);
      seq += 1;
      this.lastSeq.set(input.runId, seq);
      const doc: LocalAgentRunEventDocument = {
        runId: input.runId,
        seq,
        offset: String(seq),
        eventType: input.eventType,
        payload: input.payload ?? null,
        payloadRef: input.payloadRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: Date.now(),
      };
      const list = this.events.get(input.runId) ?? [];
      list.push(doc);
      this.events.set(input.runId, list);
      this.pendingEvents.push(doc);
      return doc;
    },
    list: async ({ runId, afterOffset, limit }) => {
      const after = afterOffset ? Number(afterOffset) || 0 : 0;
      const max = limit ?? 500;
      const inMemory = this.events.get(runId) ?? [];
      const firstInMemory = inMemory[0]?.seq ?? Number.POSITIVE_INFINITY;
      let items: LocalAgentRunEventDocument[] = [];
      if (after + 1 < firstInMemory) {
        items = await this.backend.loadEvents(runId, after, max);
      }
      for (const doc of inMemory) {
        if (items.length >= max) break;
        if (doc.seq > after && !items.some((e) => e.seq === doc.seq)) items.push(doc);
      }
      items.sort((a, b) => a.seq - b.seq);
      items = items.slice(0, max);
      const last = items[items.length - 1];
      return { items, nextOffset: items.length === max && last ? last.offset : undefined };
    },
    delete: async ({ filter }) => {
      const runIds = filter.runIds?.length ? [...filter.runIds] : [...this.events.keys()];
      for (const id of runIds) {
        this.events.delete(id);
        this.lastSeq.delete(id);
      }
      this.pendingEvents = this.pendingEvents.filter((e) => !runIds.includes(e.runId));
      if (runIds.length) await this.backend.deleteEvents(runIds);
    },
  };

  // ─── checkpoints ───────────────────────────────────────────────────────────

  readonly checkpoints: LocalAgentStore["checkpoints"] = {
    get: async ({ agentId, blobId }) => {
      const k = key(agentId, blobId);
      if (this.pendingBlobDeletes.has(k)) return null;
      const cached = this.blobs.get(k);
      if (cached) return cached;
      // Resuming a chat reads hundreds of blobs one by one: load them all at once.
      await this.prefetchBlobs(agentId);
      const prefetched = this.blobs.get(k);
      if (prefetched) return prefetched;
      if (this.pendingBlobDeletes.has(k)) return null;
      const loaded = await this.backend.loadBlob(agentId, blobId);
      if (loaded) this.blobs.set(k, loaded);
      return loaded;
    },
    create: async ({ agentId, blobId, data }) => {
      this.blobs.set(key(agentId, blobId), data);
      this.dirtyBlobs.add(key(agentId, blobId));
      this.pendingBlobDeletes.delete(key(agentId, blobId));
    },
    update: async ({ agentId, blobId, data }) => {
      this.blobs.set(key(agentId, blobId), data);
      this.dirtyBlobs.add(key(agentId, blobId));
      this.pendingBlobDeletes.delete(key(agentId, blobId));
    },
    // The SDK prunes old checkpoint blobs as it goes. Deleting them from the
    // backend right away would let a stored agent row point at a blob that is
    // gone whenever the newer state fails to persist; they are deleted on
    // flush, after the state that replaced them is saved.
    delete: async ({ filter }) => {
      for (const agentId of filter.agentIds ?? []) {
        const ids = filter.blobIds?.length ? [...filter.blobIds] : await this.allBlobIds(agentId);
        for (const blobId of ids) {
          const k = key(agentId, blobId);
          this.blobs.delete(k);
          this.dirtyBlobs.delete(k);
          this.pendingBlobDeletes.add(k);
        }
      }
    },
    list: async (input) => {
      const filter = input?.filter ?? {};
      const ids = new Set<string>();
      for (const agentId of filter.agentIds ?? []) for (const id of await this.allBlobIds(agentId)) ids.add(id);
      const sorted = [...ids].filter((id) => !filter.blobIds?.length || filter.blobIds.includes(id)).sort();
      const start = filter.cursor ? sorted.findIndex((id) => id > filter.cursor!) : 0;
      const from = start < 0 ? sorted.length : start;
      const limit = filter.limit ?? DEFAULT_LIMIT;
      const items = sorted.slice(from, from + limit);
      return { items, nextCursor: from + limit < sorted.length ? items[items.length - 1] : undefined };
    },
  };

  private prefetchBlobs(agentId: string): Promise<void> {
    let pending = this.blobPrefetch.get(agentId);
    if (!pending) {
      pending = this.backend.loadAllBlobs(agentId).then(
        (all) => {
          for (const [blobId, data] of all) {
            const k = key(agentId, blobId);
            // Newer in-memory state and pruned blobs win over what was stored.
            if (!this.blobs.has(k) && !this.pendingBlobDeletes.has(k)) this.blobs.set(k, data);
          }
        },
        (error) => {
          this.log("loading the chat memory in one go failed; reading blob by blob", error);
        }
      );
      this.blobPrefetch.set(agentId, pending);
    }
    return pending;
  }

  private async allBlobIds(agentId: string): Promise<string[]> {
    const ids = new Set(await this.backend.listBlobs(agentId));
    const prefix = `${agentId}\u0000`;
    for (const k of this.blobs.keys()) if (k.startsWith(prefix)) ids.add(k.slice(prefix.length));
    for (const k of this.pendingBlobDeletes) if (k.startsWith(prefix)) ids.delete(k.slice(prefix.length));
    return [...ids];
  }

  // ─── persistence ───────────────────────────────────────────────────────────

  /**
   * Persist everything that changed. Concurrent calls share one in-flight
   * flush and schedule one more pass for writes that land meanwhile. Failed
   * writes stay dirty and are retried on the next flush.
   */
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.flushAgain = false;
          await this.flushOnce();
        } while (this.flushAgain);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** Blobs first, then agents, runs and events, so a stored pointer never names a missing row. */
  private async flushOnce(): Promise<void> {
    const blobKeys = [...this.dirtyBlobs];
    const agentIds = [...this.dirtyAgents];
    const runIds = [...this.dirtyRuns];
    const events = this.pendingEvents;
    this.dirtyBlobs.clear();
    this.dirtyAgents.clear();
    this.dirtyRuns.clear();
    this.pendingEvents = [];

    let step = "blobs";
    try {
      const blobs = blobKeys.flatMap((k) => {
        const data = this.blobs.get(k);
        if (!data) return [];
        const [agentId, blobId] = k.split("\u0000") as [string, string];
        return [{ agentId, blobId, data }];
      });
      if (blobs.length) await this.backend.saveBlobs(blobs);
      step = "agents";
      const agents = agentIds.flatMap((id) => this.agentDocs.get(id) ?? []);
      if (agents.length) await this.backend.saveAgents(agents);
      step = "runs";
      const runs = runIds.flatMap((id) => this.runDocs.get(id) ?? []);
      if (runs.length) await this.backend.saveRuns(runs);
      step = "events";
      if (events.length) await this.backend.saveEvents(events);
      // Only now is it safe to drop blobs the saved state no longer points at.
      step = "deletes";
      await this.applyBlobDeletes();
    } catch (error) {
      // Put back whatever this pass did not finish.
      // Pending deletes stay queued on any failure; applyBlobDeletes removes only what succeeded.
      const order = ["blobs", "agents", "runs", "events", "deletes"];
      const failedAt = order.indexOf(step);
      if (failedAt <= 0) for (const k of blobKeys) this.dirtyBlobs.add(k);
      if (failedAt <= 1) for (const id of agentIds) this.dirtyAgents.add(id);
      if (failedAt <= 2) for (const id of runIds) this.dirtyRuns.add(id);
      if (failedAt <= 3) this.pendingEvents = [...events, ...this.pendingEvents];
      this.log(`agent store flush failed at ${step}`, error);
      throw error;
    }
  }

  private async applyBlobDeletes(): Promise<void> {
    if (!this.pendingBlobDeletes.size) return;
    const byAgent = new Map<string, string[]>();
    for (const k of this.pendingBlobDeletes) {
      const [agentId, blobId] = k.split("\u0000") as [string, string];
      byAgent.set(agentId, [...(byAgent.get(agentId) ?? []), blobId]);
    }
    for (const [agentId, blobIds] of byAgent) {
      await this.backend.deleteBlobs(agentId, blobIds);
      for (const blobId of blobIds) this.pendingBlobDeletes.delete(key(agentId, blobId));
    }
  }

  /** Drop an agent's data from memory. Persist first: dirty data is kept. */
  evictAgent(agentId: string): void {
    if (this.dirtyAgents.has(agentId)) return;
    const runIds = [...this.runDocs.values()].filter((r) => r.agentId === agentId).map((r) => r.runId);
    if (runIds.some((id) => this.dirtyRuns.has(id))) return;
    if (this.pendingEvents.some((e) => runIds.includes(e.runId))) return;
    const prefix = `${agentId}\u0000`;
    if ([...this.dirtyBlobs].some((k) => k.startsWith(prefix))) return;
    if ([...this.pendingBlobDeletes].some((k) => k.startsWith(prefix))) return;
    this.agentDocs.delete(agentId);
    this.runsHydrated.delete(agentId);
    this.blobPrefetch.delete(agentId);
    for (const id of runIds) {
      this.runDocs.delete(id);
      this.events.delete(id);
      this.lastSeq.delete(id);
    }
    for (const k of [...this.blobs.keys()]) if (k.startsWith(prefix)) this.blobs.delete(k);
  }

  /**
   * Close runs a dead process left "running" (a restart or deploy mid-run), so
   * the SDK does not refuse the next message with "already has active run".
   * Call only when no run of this agent is live in this process.
   */
  async releaseStaleRuns(agentId: string): Promise<number> {
    await this.hydrateRuns(agentId);
    const now = Date.now();
    let released = 0;
    for (const run of [...this.runDocs.values()]) {
      if (run.agentId !== agentId || (run.status !== "running" && run.status !== "queued")) continue;
      await this.runs.update({ run: { ...run, status: "cancelled", error: run.error ?? "interrupted by a restart", endedAt: run.endedAt ?? now, updatedAt: now } });
      released++;
    }
    const agent = await this.agents.get({ agentId });
    if (agent && (agent.status === "running" || agent.activeRunId)) {
      await this.agents.update({ agent: { ...agent, status: "idle", activeRunId: null, updatedAt: now } });
      released = Math.max(released, 1);
    }
    return released;
  }

  /** Remove a whole agent (a deleted chat): rows, events and blobs. */
  async deleteAgentsEverywhere(agentIds: readonly string[]): Promise<void> {
    for (const agentId of agentIds) {
      await this.hydrateRuns(agentId);
      const runIds = [...this.runDocs.values()].filter((r) => r.agentId === agentId).map((r) => r.runId);
      await this.deleteRunsEverywhere(runIds);
      const blobIds = await this.allBlobIds(agentId);
      const prefix = `${agentId}\u0000`;
      for (const k of [...this.blobs.keys()]) if (k.startsWith(prefix)) this.blobs.delete(k);
      for (const k of [...this.dirtyBlobs]) if (k.startsWith(prefix)) this.dirtyBlobs.delete(k);
      for (const k of [...this.pendingBlobDeletes]) if (k.startsWith(prefix)) this.pendingBlobDeletes.delete(k);
      const stored = await this.backend.listBlobs(agentId);
      const all = [...new Set([...blobIds, ...stored])];
      if (all.length) await this.backend.deleteBlobs(agentId, all);
      this.agentDocs.delete(agentId);
      this.dirtyAgents.delete(agentId);
      this.runsHydrated.delete(agentId);
    }
    if (agentIds.length) await this.backend.deleteAgents(agentIds);
  }

  private async deleteRunsEverywhere(runIds: readonly string[]): Promise<void> {
    if (!runIds.length) return;
    for (const id of runIds) {
      this.runDocs.delete(id);
      this.dirtyRuns.delete(id);
      this.events.delete(id);
      this.lastSeq.delete(id);
    }
    this.pendingEvents = this.pendingEvents.filter((e) => !runIds.includes(e.runId));
    await this.backend.deleteEvents(runIds);
    await this.backend.deleteRuns(runIds);
  }
}

function encodeCursor(value: { updatedAt: number; agentId: string }): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor: string): { updatedAt: number; agentId: string } | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { updatedAt: number; agentId: string };
    return typeof parsed.updatedAt === "number" && typeof parsed.agentId === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
