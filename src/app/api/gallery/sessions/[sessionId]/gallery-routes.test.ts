import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  rpcResult: 5 as number | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  firstRowData: { originalData: { Name: "Lamp", Image: "https://x/a.jpg" } } as unknown,
  deltaRecords: [] as Array<Record<string, unknown>>,
  gtCalls: [] as string[],
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
  api.maybeSingle = async () => {
    if (table === "gallery_session_rows") return { data: { data: state.firstRowData } };
    return { data: { id: "s1" } };
  };
  api.single = async () => ({
    data: { id: "s1", workspace_id: "w1", settings: {}, settings_revision: 4 },
    error: null,
  });
  api.then = (resolve: (value: unknown) => void) =>
    resolve({ data: state.deltaRecords, error: null });
  return api;
}

vi.mock("@/lib/gallery/auth", () => ({
  requireGalleryAuth: async () => ({
    ok: true,
    headers: {},
    admin: {
      from: (table: string) => builder(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        return { data: state.rpcResult, error: null };
      },
    },
  }),
}));
vi.mock("@/lib/catalog/flag", () => ({ galleryRowStoreEnabled: () => true }));
vi.mock("@/lib/gallery/signed-urls", () => ({
  signGalleryRowImages: async () => ({}),
}));
vi.mock("@/lib/gallery/storage-admin", () => ({
  loadGalleryWorksheetAdmin: async () => null,
  loadGalleryWorksheetMatchingRevisionAdmin: async () => null,
  saveGalleryWorksheetAdmin: async () => undefined,
}));

import { PUT } from "./settings/route";
import { GET } from "./rows/route";
import { DEFAULT_AI_SETTINGS, DEFAULT_SCRAPING_SETTINGS } from "@/lib/gallery/types";

const settings = (selectedColumns: string[]) => ({
  provider: "scraping",
  originalImageColumn: "Image",
  originalImageSelectionExplicit: true,
  selectedColumns,
  columnLayout: { order: [], hidden: [] },
  scraping: { ...DEFAULT_SCRAPING_SETTINGS },
  ai: { ...DEFAULT_AI_SETTINGS },
});

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request("http://test/api/gallery/sessions/s1/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ sessionId: "s1" }) }
  );

describe("settings-only save", () => {
  beforeEach(() => {
    state.rpcResult = 5;
    state.rpcCalls = [];
  });

  it("saves settings without a worksheet or worksheet revision", async () => {
    const res = await put({
      workspaceId: "w1",
      expectedRevision: 4,
      settings: settings(["Name", "Image"]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.settings_revision).toBe(5);
    expect(body.worksheet).toBeUndefined();
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].name).toBe("save_gallery_session_settings");
  });

  it("rejects a column that is not in the sheet", async () => {
    const res = await put({
      workspaceId: "w1",
      expectedRevision: 4,
      settings: settings(["Name", "Missing"]),
    });
    expect(res.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("answers 409 when another tab saved first", async () => {
    state.rpcResult = null;
    const res = await put({
      workspaceId: "w1",
      expectedRevision: 3,
      settings: settings(["Name", "Image"]),
    });
    expect(res.status).toBe(409);
  });
});

const getRows = (query: string) =>
  GET(
    new NextRequest(`http://test/api/gallery/sessions/s1/rows?${query}`),
    { params: Promise.resolve({ sessionId: "s1" }) }
  );

describe("rows delta", () => {
  beforeEach(() => {
    state.deltaRecords = [];
    state.gtCalls = [];
  });

  it("returns only rows after the cursor and advances it", async () => {
    state.deltaRecords = [
      {
        row_id: "r2",
        row_index: 1,
        status: "ready",
        data: { galleryImagePaths: ["https://x/g.jpg"], originalData: { Name: "B" } },
        updated_at: "2026-10-01T10:00:05.000Z",
      },
    ];
    const res = await getRows("workspaceId=w1&since=2026-10-01T10:00:00.000Z");
    const body = await res.json();
    expect(state.gtCalls).toEqual(["2026-10-01T10:00:00.000Z"]);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ id: "r2", rowIndex: 1, status: "ready" });
    expect(body.cursor).toBe("2026-10-01T10:00:05.000Z");
    expect(body.hasMore).toBe(false);
  });

  it("keeps the cursor when nothing changed", async () => {
    const res = await getRows("workspaceId=w1&since=2026-10-01T10:00:00.000Z");
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.cursor).toBe("2026-10-01T10:00:00.000Z");
  });

  it("starts from a recent window when there is no cursor", async () => {
    await getRows("workspaceId=w1");
    expect(Date.now() - Date.parse(state.gtCalls[0])).toBeLessThan(3 * 60 * 1000);
  });
});
