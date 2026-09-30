import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  enabled: true,
  records: [] as Array<Record<string, unknown>>,
  gtCalls: [] as string[],
  signedPaths: [] as string[],
};

function builder(table: string) {
  const api: Record<string, unknown> = {};
  const chain = () => api;
  api.select = chain;
  api.eq = chain;
  api.order = chain;
  api.limit = chain;
  api.gt = (_column: string, value: string) => {
    state.gtCalls.push(value);
    return api;
  };
  api.maybeSingle = async () => (table === "visualizer_sessions" ? { data: { id: "s1" } } : { data: null });
  api.then = (resolve: (value: unknown) => void) => resolve({ data: state.records, error: null });
  return api;
}

vi.mock("@/lib/visualizer/auth", () => ({
  requireVisualizerAuth: async () => ({
    ok: true,
    headers: {},
    admin: { from: (table: string) => builder(table) },
  }),
}));
vi.mock("@/lib/catalog/flag", () => ({ visualizerRowStoreEnabled: () => state.enabled }));
vi.mock("@/lib/visualizer/storage-admin", () => ({
  createVisualizerSignedUrlsAdmin: async (paths: string[]) => {
    state.signedPaths = paths;
    return Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`]));
  },
}));

import { GET } from "./route";

const call = (query: string) =>
  GET(new NextRequest(`http://test/api/visualizer/sessions/s1/rows?workspaceId=w1${query}`), {
    params: Promise.resolve({ sessionId: "s1" }),
  });

describe("visualizer rows delta", () => {
  beforeEach(() => {
    state.enabled = true;
    state.records = [];
    state.gtCalls = [];
    state.signedPaths = [];
  });

  it("returns changed rows with signed links for their stored images and a cursor", async () => {
    state.records = [
      {
        row_id: "r1",
        row_index: 0,
        status: "generating",
        updated_at: "2026-09-30T10:00:01.000Z",
        data: {
          originalData: { Title: "Shoe" },
          imagePlaceholders: [
            { index: 1, visualBrief: "b", alt: "a", storagePath: "w/s/r1/1.jpg" },
            { index: 2, visualBrief: "b", alt: "a", storagePath: null },
          ],
        },
      },
    ];
    const res = await call("&since=2026-09-30T10:00:00.000Z");
    const body = await res.json();
    expect(state.gtCalls).toEqual(["2026-09-30T10:00:00.000Z"]);
    expect(body.supported).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ id: "r1", rowIndex: 0, status: "generating" });
    expect(state.signedPaths).toEqual(["w/s/r1/1.jpg"]);
    expect(body.signedUrls["w/s/r1/1.jpg"]).toBe("https://signed/w/s/r1/1.jpg");
    expect(body.cursor).toBe("2026-09-30T10:00:01.000Z");
    expect(body.hasMore).toBe(false);
  });

  it("looks back a short window when there is no cursor", async () => {
    await call("");
    expect(state.gtCalls).toHaveLength(1);
    expect(Date.now() - Date.parse(state.gtCalls[0])).toBeLessThan(3 * 60 * 1000);
  });

  it("tells the client to use the full load when the row store is off", async () => {
    state.enabled = false;
    const res = await call("");
    expect(await res.json()).toEqual({ supported: false });
  });
});
