import { IMAGE_SOURCES_COLUMN_ID, LENS_FOUNDS_COLUMN_ID, PRODUCT_MODE_COLUMN_IDS, SOURCE_URLS_COLUMN_ID } from "@/types";

/**
 * A row has one status for the whole sheet, so a failure has to say which tool
 * it came from: the retry button of the sidebar only counts the rows that
 * failed in the tool that is open. The tool is written in front of the row's
 * error message ("Source Finder: ..."), which is also what the status tooltip
 * shows. The names are the ones on the rail.
 */
export const FAILED_TOOLS = ["Source Finder", "Image Finder", "Lens Source Checker", "Categorize", "Enrichment"] as const;
export type FailedTool = (typeof FAILED_TOOLS)[number];

/** The tool a run belongs to, from the output columns it generates. */
export function toolForRunColumns(columnIds: readonly string[]): FailedTool {
  const within = (allowed: readonly string[]) => columnIds.length > 0 && columnIds.every((id) => allowed.includes(id));
  if (within([LENS_FOUNDS_COLUMN_ID])) return "Lens Source Checker";
  if (within([PRODUCT_MODE_COLUMN_IDS.categories])) return "Categorize";
  if (within([PRODUCT_MODE_COLUMN_IDS.images, IMAGE_SOURCES_COLUMN_ID, SOURCE_URLS_COLUMN_ID])) {
    return columnIds.includes(PRODUCT_MODE_COLUMN_IDS.images) ? "Image Finder" : "Source Finder";
  }
  return "Enrichment";
}

/** The error message of a failed row, led by the tool it failed in. */
export function tagRowFailure(tool: FailedTool, message: string | undefined): string {
  const text = (message ?? "").trim() || "The row failed.";
  return failureToolOf(text) ? text : `${tool}: ${text}`;
}

/** The tool a failed row's error message names, or null for a failure recorded before the tool was written. */
export function failureToolOf(message: string | undefined): FailedTool | null {
  if (!message) return null;
  return FAILED_TOOLS.find((tool) => message.startsWith(`${tool}: `)) ?? null;
}

/**
 * Whether a row counts as failed in `tool`. A failure with no tool written
 * (made before this existed) counts in every tool, so it can still be retried.
 */
export function failedInTool(row: { status: string; errorMessage?: string }, tool: FailedTool): boolean {
  if (row.status !== "error") return false;
  const named = failureToolOf(row.errorMessage);
  return named === null || named === tool;
}
