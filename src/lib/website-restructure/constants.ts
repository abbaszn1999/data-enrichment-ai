// Runtime retry hints for the Website Restructure agent calls. These are
// appended to a user prompt on a retry, not skill bodies, so they live here
// rather than in `skills/*.md` (see `skill-loader.ts`).

/** Appended to the header-builder prompt on a retry after the first attempt
 *  was cut short (finishReason RECITATION), which in practice is always the
 *  icon path data. Stated as the reason for the retry so the model does not
 *  repeat it. */
export const WR_RECITATION_RETRY_HINT = `
IMPORTANT — your previous attempt was cut off by the copyright filter, almost
certainly because of the SVG icon path data. Rebuild the same header, but make
every icon trivially simple and unmistakably your own: only <rect>, <circle>,
<line>, and <polyline> elements with short integer coordinates on a
0 0 24 24 viewBox. No <path> curve data at all this time. Use at most five
icons in the whole header.
`.trim();

/** Appended to the IA planner prompt on a retry after the first attempt
 *  produced a tree with a node deeper than `WR_MAX_NAV_CLICK_DEPTH`. */
export const WR_NAV_DEPTH_RETRY_HINT = `
IMPORTANT — your previous nav plan had at least one entry deeper than 3 levels
from the header (department -> category -> subcategory). Rebuild the plan so
every node sits at depth 1, 2, or 3: merge or flatten anything deeper into its
nearest ancestor rather than inventing a 4th level. Deep/long-tail clusters
that don't fit within 3 levels should be folded into the closest matching
department/category/subcategory instead of becoming their own deeper node.
`.trim();
