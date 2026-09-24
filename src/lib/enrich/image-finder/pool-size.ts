/**
 * How many raw image candidates to request from web_search per call, versus
 * how many the agent may actually return. These are deliberately different
 * numbers: OpenAI's `image_settings.max_results` caps what the search tool
 * hands back, so requesting exactly the final target leaves zero margin —
 * one bad candidate and the row comes up short. Over-fetch, then let the
 * skill's phases (identity lock, dedup, acceptance bar) narrow it down.
 *
 * Same shape as Gallery's `candidatePoolSize` (src/lib/gallery/agents/
 * scraping-shared.ts), which already proves this pattern in production —
 * applied here at the top of Image Finder's range since it has no separate
 * "search depth" setting to tune.
 */
export function imageFinderCandidatePoolSize(requestedImages: number): number {
  const base = Math.max(1, requestedImages);
  return Math.min(50, Math.max(20, base * 4));
}
