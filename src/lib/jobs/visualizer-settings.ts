import type { VisualizerPhase, VisualizerProjectSettings, VisualizerRowStatus } from "@/lib/visualizer/types";
import type { JobRunSettings } from "./types";

export interface VisualizerJobSettings extends JobRunSettings {
  phase: VisualizerPhase;
  visualizerRunId: string;
  targetIds: string[];
  previousStatus: Record<string, VisualizerRowStatus>;
  ownerUserId: string;
  actorUserId: string;
  estimatedCredits: number;
  runtimeSettings: VisualizerProjectSettings;
}
