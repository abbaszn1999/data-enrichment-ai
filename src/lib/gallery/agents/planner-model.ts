import { GALLERY_PLANNER_OPENAI_MODEL } from "@/lib/enrich/models";

/**
 * Model for the generate-mode prompt planner. It is the same for every tier:
 * the tier (Standard / Premium) only picks the image model.
 */
export type GalleryPlannerModelId = typeof GALLERY_PLANNER_OPENAI_MODEL;

export function resolveGalleryPlannerModel(
  ...args: Array<"standard" | "premium" | undefined>
): GalleryPlannerModelId {
  void args;
  return GALLERY_PLANNER_OPENAI_MODEL;
}
