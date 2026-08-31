import { parseGalleryProjectSettings } from "@/lib/gallery/settings-schema";
import {
  applyGalleryProjectSettings,
  type GalleryProjectSettings,
  type GalleryProvider,
  type GalleryRowStatus,
  type GalleryRunPhase,
  type GalleryWorksheetJson,
} from "@/lib/gallery/types";
import type { JobRunSettings } from "./types";

export interface GalleryJobSettings extends JobRunSettings {
  provider: GalleryProvider;
  galleryRunId: string;
  targetIds: string[];
  targetPhases: Record<string, GalleryRunPhase>;
  previousStatus: Record<string, GalleryRowStatus>;
  ownerUserId: string;
  actorUserId: string;
  estimatedCredits: number;
  /**
   * Frozen project settings for this run. Worksheet.json no longer stores
   * scraping/AI settings, so the worker must not read defaults from a
   * reloaded worksheet.
   */
  runtimeSettings?: GalleryProjectSettings;
}

export function parseGalleryJobRuntimeSettings(
  value: unknown
): GalleryProjectSettings | null {
  if (!value || typeof value !== "object") return null;
  try {
    return parseGalleryProjectSettings(value);
  } catch {
    return null;
  }
}

/** Reattach the run's settings after loading a settings-stripped worksheet. */
export function hydrateGalleryWorksheetForJob(
  worksheet: GalleryWorksheetJson,
  runtimeSettings: GalleryProjectSettings | null | undefined
): GalleryWorksheetJson {
  if (!runtimeSettings) return worksheet;
  return applyGalleryProjectSettings(worksheet, runtimeSettings);
}
