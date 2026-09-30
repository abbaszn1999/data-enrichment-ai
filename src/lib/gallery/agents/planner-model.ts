/**
 * Model for the AI-generation planner (Products Gallery "AI generate" mode).
 * Scraping mode no longer has tiers - it always runs GPT-6.1 Sol (see
 * gallery-research-agent.ts). The planner keeps its own choice unchanged.
 */
export type GalleryPlannerModelId = "gpt-5.6-terra" | "gpt-5.6-sol";

export const GALLERY_PLANNER_MODELS = {
  standard: "gpt-5.6-terra",
  premium: "gpt-5.6-sol",
} as const satisfies Record<"standard" | "premium", GalleryPlannerModelId>;

export function resolveGalleryPlannerModel(
  tier: "standard" | "premium" | undefined
): GalleryPlannerModelId {
  return tier === "premium" ? GALLERY_PLANNER_MODELS.premium : GALLERY_PLANNER_MODELS.standard;
}
