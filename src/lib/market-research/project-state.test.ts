import { describe, expect, it } from "vitest";
import { emptyMarketResearchState } from "@/components/market-research/persistence";
import {
  assignUuidProjectIds,
  isUuid,
  projectStateSlice,
  rowsToPersisted,
} from "./project-state";

describe("market-research project state", () => {
  it("round-trips a project through row mapping", () => {
    const persisted = emptyMarketResearchState();
    const id = "11111111-1111-4111-8111-111111111111";
    persisted.projects = [
      {
        id,
        name: "Eyewear",
        status: "active",
        storeLabel: "Store",
        highlightedCollectionIds: ["sunglasses"],
      },
    ];
    persisted.activeProjectId = id;
    persisted.stage1DoneIds = [id];
    persisted.openedMaxByProject[id] = 3;
    persisted.extractRowsByProject[id] = 40;
    persisted.keywordsByProject[id] = [
      {
        id: "k1",
        seedId: "s1",
        seed: "sunglasses",
        keyword: "buy sunglasses",
        volume: 100,
        difficulty: 12,
        wordCount: 2,
        isQuestion: false,
        sheet: "category",
        productMatches: 0,
        weight: 1,
      },
    ];

    const slice = projectStateSlice(persisted, id);
    const back = rowsToPersisted(
      [
        {
          id,
          name: "Eyewear",
          status: "active",
          store_label: "Store",
          highlighted_collection_ids: ["sunglasses"],
          market: "us-en",
          current_stage: 3,
          opened_max_stage: 3,
          state: slice,
          keywords_path: null,
          extract_rows: 40,
          extract_charged_usd: 0,
        },
      ],
      id
    );
    expect(back.projects[0]?.name).toBe("Eyewear");
    expect(back.stage1DoneIds).toContain(id);
    expect(back.keywordsByProject[id]?.[0]?.keyword).toBe("buy sunglasses");
    expect(back.extractRowsByProject[id]).toBe(40);
  });

  it("assigns uuids to legacy local project ids", () => {
    const persisted = emptyMarketResearchState();
    persisted.projects = [
      {
        id: "proj-1",
        name: "Legacy",
        status: "active",
        storeLabel: "Store",
        highlightedCollectionIds: [],
      },
    ];
    persisted.activeProjectId = "proj-1";
    persisted.stage1DoneIds = ["proj-1"];
    const next = assignUuidProjectIds(persisted);
    expect(isUuid(next.projects[0]!.id)).toBe(true);
    expect(next.activeProjectId).toBe(next.projects[0]!.id);
    expect(next.stage1DoneIds).toEqual([next.projects[0]!.id]);
  });

  it("handles storage slice paths cleanly", async () => {
    const { mrSlicePath, mrProjectPath, mrExtractChunkPath } = await import(
      "./storage-admin"
    );
    const workspaceId = "ws-123";
    const projectId = "proj-456";

    expect(mrProjectPath(workspaceId, projectId)).toBe(
      "ws-123/market-research/proj-456"
    );
    expect(mrSlicePath(workspaceId, projectId, "keywords")).toBe(
      "ws-123/market-research/proj-456/keywords.json"
    );
    expect(mrSlicePath(workspaceId, projectId, "niches")).toBe(
      "ws-123/market-research/proj-456/niches.json"
    );
    expect(mrSlicePath(workspaceId, projectId, "seeds")).toBe(
      "ws-123/market-research/proj-456/seeds.json"
    );
    expect(mrSlicePath(workspaceId, projectId, "collections")).toBe(
      "ws-123/market-research/proj-456/collections.json"
    );
    expect(mrSlicePath(workspaceId, projectId, "content")).toBe(
      "ws-123/market-research/proj-456/content.json"
    );
    expect(
      mrExtractChunkPath(workspaceId, projectId, "ext-1", "run-1", "100")
    ).toBe("ws-123/market-research/proj-456/extracts/ext-1/run-1/100.json");
  });
});
