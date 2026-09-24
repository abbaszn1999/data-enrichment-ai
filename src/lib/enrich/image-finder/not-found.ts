/**
 * Sibling key stored next to an Image Finder column's value: the model's own
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
