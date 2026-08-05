import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/visualizer/storage-admin", () => ({
  loadVisualizerWorksheetAdmin: vi.fn(),
  loadVisualizerWorksheetMatchingRevisionAdmin: vi.fn(),
  saveVisualizerWorksheetAdmin: vi.fn(async () => "path"),
}));

import { healVisualizerSessionOnRead } from "@/lib/visualizer/session-heal";
import type {
  VisualizerSession,
  VisualizerWorksheetJson,
} from "@/lib/visualizer/types";
import { DEFAULT_VISUALIZER_SETTINGS } from "@/lib/visualizer/types";

function makeSession(
  overrides: Partial<VisualizerSession> = {}
): VisualizerSession {
  return {
    id: "s1",
    workspace_id: "w1",
    name: "Test",
    status: "processing",
    source_file_name: "a.xlsx",
    storage_path: null,
    images_prefix: null,
    total_rows: 5,
    ready_rows: 0,
    failed_rows: 0,
    total_cost: 0,
    total_credits: 0,
    error_message: null,
    awaiting_user_action: false,
    active_phase: "description",
    cancel_requested: false,
    worksheet_revision: 4,
    settings: DEFAULT_VISUALIZER_SETTINGS,
    settings_revision: 1,
    created_by: "u1",
    created_at: new Date().toISOString(),
    updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function makeWorksheet(
  overrides: Partial<VisualizerWorksheetJson> = {}
): VisualizerWorksheetJson {
  return {
    sessionId: "s1",
    columns: ["Name"],
    settings: DEFAULT_VISUALIZER_SETTINGS,
    activeRun: {
      id: "r1",
      phase: "description",
      status: "running",
      total: 1,
      completed: 0,
      failed: 0,
      startedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    rows: [
      {
        id: "row1",
        rowIndex: 0,
        originalData: { Name: "A" },
        status: "generating",
      },
    ],
    revision: 3,
    ...overrides,
  };
}

describe("healVisualizerSessionOnRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defers while a fresh run is still syncing a newer DB revision", async () => {
    const admin = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      }),
    } as never;

    const result = await healVisualizerSessionOnRead({
      admin,
      workspaceId: "w1",
      session: makeSession({
        updated_at: new Date().toISOString(),
      }),
      worksheet: makeWorksheet({
        revision: 3,
        activeRun: {
          id: "r1",
          phase: "description",
          status: "running",
          total: 1,
          completed: 0,
          failed: 0,
          startedAt: new Date().toISOString(),
        },
      }),
      usedFallback: true,
    });

    expect(result.stillSyncing).toBe(true);
    expect(result.healed).toBe(false);
  });

  it("recovers a stale desynced processing session so it can open", async () => {
    const updates: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          };
        },
      }),
    } as never;

    const result = await healVisualizerSessionOnRead({
      admin,
      workspaceId: "w1",
      session: makeSession(),
      worksheet: makeWorksheet(),
      usedFallback: true,
      staleRunMs: 60_000,
    });

    expect(result.stillSyncing).toBeFalsy();
    expect(result.healed).toBe(true);
    expect(result.session.worksheet_revision).toBe(3);
    expect(result.session.total_rows).toBe(1);
    expect(result.session.status).toBe("failed");
    expect(result.worksheet.activeRun?.status).toBe("failed");
    expect(result.worksheet.rows[0]?.status).toBe("failed");
    expect(updates.some((u) => u.status === "failed")).toBe(true);
  });
});
