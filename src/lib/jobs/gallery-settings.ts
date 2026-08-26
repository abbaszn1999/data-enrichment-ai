import type { GalleryProvider, GalleryRowStatus, GalleryRunPhase } from "@/lib/gallery/types";
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
}
