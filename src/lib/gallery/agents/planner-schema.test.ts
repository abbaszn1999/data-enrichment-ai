import { describe, expect, it } from "vitest";
import { buildPlannerResponseSchema } from "@/lib/gallery/agents/planner-prompts";
import { readStoredGalleryPlan } from "@/lib/gallery/agents/ai-planner-agent";

describe("gallery planner schema", () => {
  it("requires main only on full and gallery of length N", () => {
    const full = buildPlannerResponseSchema({ galleryCount: 4, needMain: true });
    expect(full.required).toEqual(["main", "gallery", "notes"]);
    expect(full.properties.gallery.minItems).toBe(4);
    expect(full.properties.gallery.maxItems).toBe(4);

    const galleryOnly = buildPlannerResponseSchema({
      galleryCount: 3,
      needMain: false,
    });
    expect(galleryOnly.required).toEqual(["gallery", "notes"]);
    expect(
      (galleryOnly.properties as { main?: unknown }).main
    ).toBeUndefined();
    expect(galleryOnly.properties.gallery.minItems).toBe(3);
  });

  it("rejects a stored plan when gallery count or fingerprint does not match", () => {
    const fingerprint = '{"galleryCount":2}';
    const row = {
      sourceMeta: {
        plan: {
          fingerprint,
          gallery: [
            { index: 1, specClaim: "a", visualBrief: "brief a", alt: "a" },
          ],
        },
      },
    };
    expect(readStoredGalleryPlan(row, fingerprint, 2, false)).toBeNull();
    expect(readStoredGalleryPlan(row, "other", 1, false)).toBeNull();
  });
});
