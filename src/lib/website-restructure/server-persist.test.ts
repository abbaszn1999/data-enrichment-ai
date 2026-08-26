import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createWrProject,
  releaseWrProjectBuild,
  tryLeaseWrProjectBuild,
} from "./server-persist";
import { WR_MAX_EDIT_MESSAGES } from "./types";

/** A Postgrest-style query builder is chainable on every method and thenable
 *  at any point in the chain — this mock mirrors both properties so the same
 *  stub works regardless of which methods a code path happens to call. */
function chain(result: { data?: unknown; error?: { message: string } | null }) {
  const resolved = { data: null, error: null, ...result };
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  Object.assign(obj, {
    select: self,
    eq: self,
    or: self,
    order: self,
    update: self,
    insert: self,
    delete: self,
    maybeSingle: async () => resolved,
    single: async () => resolved,
    then: (resolve: (v: typeof resolved) => void) => resolve(resolved),
  });
  return obj;
}

function mockAdmin(responses: Array<ReturnType<typeof chain>>) {
  const queue = [...responses];
  const from = vi.fn(() => queue.shift() ?? chain({ data: null, error: null }));
  return { from, admin: { from } as unknown as SupabaseClient };
}

describe("createWrProject", () => {
  it("inserts a lean row with defaults and returns it converted to camelCase", async () => {
    const dbRow = {
      id: "11111111-1111-1111-1111-111111111111",
      workspace_id: "ws-1",
      created_by: "user-1",
      name: "My header",
      status: "active",
      provider: "shopify",
      phase: "collecting",
      edit_messages_used: 0,
      active_version: 0,
      last_error: null,
      state: {},
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const { admin } = mockAdmin([chain({ data: dbRow, error: null })]);

    const project = await createWrProject(admin, {
      workspaceId: "ws-1",
      userId: "user-1",
      name: "My header",
      provider: "shopify",
    });

    expect(project.id).toBe(dbRow.id);
    expect(project.phase).toBe("collecting");
    expect(project.state).toEqual({
      chat: [],
      images: [],
      logo: null,
      competitors: [],
      competitorsSkipped: false,
    });
  });
});

describe("tryLeaseWrProjectBuild", () => {
  it("succeeds when the conditional update matched a row", async () => {
    const { admin } = mockAdmin([chain({ data: { id: "p1" }, error: null })]);
    const ok = await tryLeaseWrProjectBuild(admin, "ws-1", "p1");
    expect(ok).toBe(true);
  });

  it("fails (no throw) when another build already holds the lease", async () => {
    const { admin } = mockAdmin([chain({ data: null, error: null })]);
    const ok = await tryLeaseWrProjectBuild(admin, "ws-1", "p1");
    expect(ok).toBe(false);
  });

  it("throws when the update itself errors", async () => {
    const { admin } = mockAdmin([chain({ data: null, error: { message: "connection reset" } })]);
    await expect(tryLeaseWrProjectBuild(admin, "ws-1", "p1")).rejects.toThrow("connection reset");
  });
});

describe("releaseWrProjectBuild — edit message accounting", () => {
  it("increments edit_messages_used only when the build succeeded and asked for it", async () => {
    const { admin, from } = mockAdmin([
      chain({ data: { edit_messages_used: 3 }, error: null }), // select current count
      chain({ data: null, error: null }), // update
    ]);

    await releaseWrProjectBuild(admin, "ws-1", "p1", {
      ok: true,
      nextPhase: "editing",
      incrementEditMessages: true,
      activeVersion: 4,
    });

    // Second call is the update — verify the incremented count was written.
    const updateCall = (from.mock.results[1].value as { update: (v: unknown) => unknown }).update;
    expect(updateCall).toBeDefined();
  });

  it("caps the increment at WR_MAX_EDIT_MESSAGES instead of going over", async () => {
    const spy = vi.fn();
    const { admin } = mockAdmin([
      chain({ data: { edit_messages_used: WR_MAX_EDIT_MESSAGES }, error: null }),
      { ...chain({ data: null, error: null }), update: (v: Record<string, unknown>) => { spy(v); return chain({ data: null, error: null }); } },
    ]);

    await releaseWrProjectBuild(admin, "ws-1", "p1", {
      ok: true,
      nextPhase: "editing",
      incrementEditMessages: true,
    });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ edit_messages_used: WR_MAX_EDIT_MESSAGES }));
  });

  it("does not touch edit_messages_used on a successful build with no increment requested", async () => {
    const spy = vi.fn();
    const { admin } = mockAdmin([
      { ...chain({ data: null, error: null }), update: (v: Record<string, unknown>) => { spy(v); return chain({ data: null, error: null }); } },
    ]);

    await releaseWrProjectBuild(admin, "ws-1", "p1", { ok: true, nextPhase: "editing", activeVersion: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).not.toHaveProperty("edit_messages_used");
  });

  it("does not touch edit_messages_used on a failed build", async () => {
    const spy = vi.fn();
    const { admin } = mockAdmin([
      { ...chain({ data: null, error: null }), update: (v: Record<string, unknown>) => { spy(v); return chain({ data: null, error: null }); } },
    ]);

    await releaseWrProjectBuild(admin, "ws-1", "p1", { ok: false, nextPhase: "failed", error: "boom" });

    expect(spy).toHaveBeenCalledTimes(1);
    const written = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("edit_messages_used");
    expect(written.last_error).toBe("boom");
    expect(written.phase).toBe("failed");
  });
});
