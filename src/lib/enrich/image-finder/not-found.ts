/**
 * Sibling keys stored next to an Image Finder column's value. This one: the model's own
 * explanation for why it returned zero images. Read by the sheet UI to show a
 * "Not found" state distinct from "not yet processed" — never rendered as its
 * own column, since it isn't in enrichmentColumns.
 *
 * Client-safe (no server-only imports) so both the agent and the sheet grid
 * can import it.
 */
export function imageFinderNotFoundKey(columnId: string): string {
  return `${columnId}__notFoundReason`;
}

/** Sibling key holding how the images were matched: identifier, near_identifier, model_variant or best_match. */
export function imageFinderMatchBasisKey(columnId: string): string {
  return `${columnId}__matchBasis`;
}

/** Sibling key holding the store-owner-facing note for anything weaker than an exact code match. */
export function imageFinderMatchNoteKey(columnId: string): string {
  return `${columnId}__matchNote`;
}

/** Match types that are not an exact code match, so the sheet labels them. */
export function isApproximateImageMatch(matchBasis: unknown): boolean {
  return matchBasis === "near_identifier" || matchBasis === "best_match" || matchBasis === "model_variant";
}

export function imageMatchLabel(matchBasis: unknown): string {
  switch (matchBasis) {
    case "near_identifier":
      return "Near code";
    case "best_match":
      return "Best match";
    case "model_variant":
      return "Model match";
    default:
      return "";
  }
}
