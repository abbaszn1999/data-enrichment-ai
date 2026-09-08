import type { Json } from "@/types/database";
import type {
  CategoryItem,
  ContentLength,
  EnrichmentColumnType,
  SessionKind,
  WritingTone,
} from "@/types";

export type JobKind = "catalog" | "gallery" | "visualizer" | "mr_extract";

export type JobRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused_no_credits";

export type NotificationEvent = "completed" | "failed" | "paused_no_credits";

export interface JobRunSettings {
  workspaceSlug?: string;
  sessionName?: string;
  [key: string]: unknown;
}

export interface CatalogJobSettings extends JobRunSettings {
  kind: SessionKind;
  enabledColumns: string[];
  enrichmentColumns: Array<{
    id: string;
    label: string;
    description: string;
    type: string;
    enabled?: boolean;
    imageCount?: number;
    sourceCount?: number;
    maxCategories?: number;
    itemCount?: number;
    maxChars?: number;
    customInstruction?: string;
    writingTone?: string;
    contentLength?: string;
    isCustom?: boolean;
  }>;
  enrichmentModel?: string;
  outputLanguage?: string;
  cmsType?: string;
  sourceColumns: string[];
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  ownerUserId: string;
  actorUserId: string;
  processedRowIds?: string[];
}

export interface JobRunRecord {
  id: string;
  workspace_id: string;
  kind: JobKind;
  session_id: string;
  created_by: string;
  status: JobRunStatus;
  target_ids: string[];
  completed_count: number;
  failed_count: number;
  heartbeat_at: string | null;
  cancel_requested: boolean;
  task_run_id: string | null;
  last_error: string | null;
  settings: JobRunSettings;
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  workspace_id: string;
  user_id: string;
  job_run_id: string;
  event: NotificationEvent;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
}

export interface JobInboxActiveRun {
  id: string;
  kind: JobKind;
  sessionId: string;
  status: JobRunStatus;
  completedCount: number;
  failedCount: number;
  total: number;
  href: string;
  sessionName: string;
  createdAt: string;
}

export const TERMINAL_JOB_STATUSES: readonly JobRunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "paused_no_credits",
];

export function isTerminalJobStatus(status: JobRunStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export function asJobSettings(value: Json | JobRunSettings | null | undefined): JobRunSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JobRunSettings;
}

export type { EnrichmentColumnType, WritingTone, ContentLength, SessionKind };
