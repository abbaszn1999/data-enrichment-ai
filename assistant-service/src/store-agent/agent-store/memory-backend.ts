import type { LocalAgentDocument, LocalAgentRunDocument, LocalAgentRunEventDocument } from "@cursor/sdk";
import type { AgentStoreBackend } from "./write-behind-store";

/** In-process backend for tests: same contract as the Supabase backend. */
export class MemoryAgentStoreBackend implements AgentStoreBackend {
  readonly agents = new Map<string, LocalAgentDocument>();
  readonly runs = new Map<string, LocalAgentRunDocument>();
  readonly events = new Map<string, LocalAgentRunEventDocument[]>();
  readonly blobs = new Map<string, Uint8Array>();
  /** Number of calls per method, to assert batching. */
  readonly calls = new Map<string, number>();
  /** When set, the named method throws once. */
  failOnce: string | null = null;

  private hit(name: string) {
    this.calls.set(name, (this.calls.get(name) ?? 0) + 1);
    if (this.failOnce === name) {
      this.failOnce = null;
      throw new Error(`${name} failed`);
    }
  }

  async loadAgent(agentId: string) {
    this.hit("loadAgent");
    return this.agents.get(agentId) ?? null;
  }
  async listAgents(filter: { cwd?: string; limit: number; afterUpdatedAt?: number }) {
    this.hit("listAgents");
    return [...this.agents.values()]
      .filter((a) => !filter.cwd || a.cwd === filter.cwd)
      .filter((a) => filter.afterUpdatedAt === undefined || a.updatedAt <= filter.afterUpdatedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, filter.limit);
  }
  async saveAgents(agents: readonly LocalAgentDocument[]) {
    this.hit("saveAgents");
    for (const a of agents) this.agents.set(a.agentId, a);
  }
  async deleteAgents(agentIds: readonly string[]) {
    this.hit("deleteAgents");
    for (const id of agentIds) this.agents.delete(id);
  }
  async loadRuns(agentId: string) {
    this.hit("loadRuns");
    return [...this.runs.values()].filter((r) => r.agentId === agentId);
  }
  async saveRuns(runs: readonly LocalAgentRunDocument[]) {
    this.hit("saveRuns");
    for (const r of runs) this.runs.set(r.runId, r);
  }
  async deleteRuns(runIds: readonly string[]) {
    this.hit("deleteRuns");
    for (const id of runIds) this.runs.delete(id);
  }
  async lastEventSeq(runId: string) {
    this.hit("lastEventSeq");
    const list = this.events.get(runId) ?? [];
    return list.reduce((max, e) => Math.max(max, e.seq), 0);
  }
  async loadEvents(runId: string, afterSeq: number, limit: number) {
    this.hit("loadEvents");
    return (this.events.get(runId) ?? []).filter((e) => e.seq > afterSeq).slice(0, limit);
  }
  async saveEvents(events: readonly LocalAgentRunEventDocument[]) {
    this.hit("saveEvents");
    for (const e of events) {
      const list = this.events.get(e.runId) ?? [];
      if (!list.some((x) => x.seq === e.seq)) list.push(e);
      list.sort((a, b) => a.seq - b.seq);
      this.events.set(e.runId, list);
    }
  }
  async deleteEvents(runIds: readonly string[]) {
    this.hit("deleteEvents");
    for (const id of runIds) this.events.delete(id);
  }
  async loadBlob(agentId: string, blobId: string) {
    this.hit("loadBlob");
    return this.blobs.get(`${agentId}/${blobId}`) ?? null;
  }
  async loadAllBlobs(agentId: string) {
    this.hit("loadAllBlobs");
    const out = new Map<string, Uint8Array>();
    for (const [k, data] of this.blobs) if (k.startsWith(`${agentId}/`)) out.set(k.slice(agentId.length + 1), data);
    return out;
  }
  async saveBlobs(blobs: ReadonlyArray<{ agentId: string; blobId: string; data: Uint8Array }>) {
    this.hit("saveBlobs");
    for (const b of blobs) this.blobs.set(`${b.agentId}/${b.blobId}`, b.data);
  }
  async listBlobs(agentId: string) {
    this.hit("listBlobs");
    return [...this.blobs.keys()].filter((k) => k.startsWith(`${agentId}/`)).map((k) => k.slice(agentId.length + 1));
  }
  async deleteBlobs(agentId: string, blobIds: readonly string[]) {
    this.hit("deleteBlobs");
    for (const id of blobIds) this.blobs.delete(`${agentId}/${id}`);
  }
}
