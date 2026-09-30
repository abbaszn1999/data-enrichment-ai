import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  rpcResult: 8 as number | null,
  rpcCalls: [] as Array<Record<string, unknown>>,
  worksheetWrites: 0,
  session: { id: "s1", workspace_id: "w1", status: "processing", settings_revision: 7 },
};

function table() {
  const api: Record<string, unknown> = {};
  const chain = () => api;
  api.select = chain;
  api.eq = chain;
  api.order = chain;
  api.limit = chain;
  api.maybeSingle = async () => ({
    data: { data: { originalData: { Title: "Shoe", Image: "https://cdn/x.jpg" } } },
  });
  api.single = async () => ({ data: state.session, error: null });
  return api;
}

vi.mock("@/lib/visualizer/auth", () => ({
  requireVisualizerAuth: async () => ({
    ok: true,
    headers: {},
    admin: {
      from: () => table(),
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, ...args });
        return { data: state.rpcResult, error: null };
      },
    },
  }),
}));
vi.mock("@/lib/catalog/flag", () => ({ visualizerRowStoreEnabled: () => true }));
vi.mock("@/lib/visualizer/storage-admin", () => ({
  loadVisualizerWorksheetAdmin: vi.fn(),
  loadVisualizerWorksheetMatchingRevisionAdmin: vi.fn(),
  saveVisualizerWorksheetAdmin: async () => {
    state.worksheetWrites += 1;
    return "path";
  },
}));

import { PUT } from "./route";

const put = (body: Record<string, unknown>) =>
  PUT(
    new NextRequest("http://test/api/visualizer/sessions/s1/settings", {
      method: "PUT",
      body: JSON.stringify({ workspaceId: "w1", expectedRevision: 7, ...body }),
    }),
    { params: Promise.resolve({ sessionId: "s1" }) }
  );

const settings = {
  selectedColumns: ["Title"],
  productImageColumn: "Image",
  images: { tier: "premium" },
};

describe("visualizer settings autosave", () => {
  beforeEach(() => {
    state.rpcResult = 8;
    state.rpcCalls = [];
    state.worksheetWrites = 0;
  });

  it("saves settings alone, even during a run, without rewriting rows", async () => {
    const res = await put({ settings });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.rpcCalls[0]).toMatchObject({
      name: "save_visualizer_session_settings",
      p_expected_revision: 7,
    });
    expect(state.worksheetWrites).toBe(0);
    expect(body.session.settings_revision).toBe(8);
    expect(body.settings.images.tier).toBe("premium");
  });

  it("returns the current revision on a conflict so the page can retry", async () => {
    state.rpcResult = null;
    const res = await put({ settings });
    expect(res.status).toBe(409);
    expect((await res.json()).currentRevision).toBe(7);
  });

  it("rejects columns that are not in the sheet", async () => {
    const res = await put({ settings: { ...settings, selectedColumns: ["Nope"] } });
    expect(res.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
