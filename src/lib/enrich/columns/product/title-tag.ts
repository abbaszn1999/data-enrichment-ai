import type { ColumnSpec } from "../types";
import {
  asTrimmedString,
  clampChars,
  describeColumn,
  promptLine,
} from "../shared/helpers";

/** Search engines truncate around 60 characters; leave a little headroom. */
export const TITLE_TAG_TARGET = "50-60";
export const TITLE_TAG_HARD_MAX = 70;

const CHARACTER_COUNT_RE = /(\d{2,4})(?:\s*(?:-|–|to)\s*(\d{2,4}))?\s*(?:characters?|chars?)\b/gi;

/**
 * The longest title the owner's own instruction asks for ("100 characters",
 * "80-100 chars"), when it asks for more than the built-in limit. The shipped
 * starting instruction says 50-60, so it never raises the limit.
 */
export function ownerTitleLength(instruction: string | undefined): number | undefined {
  let longest = 0;
  for (const match of (instruction ?? "").matchAll(CHARACTER_COUNT_RE)) {
    longest = Math.max(longest, Number(match[1]), Number(match[2] ?? 0));
  }
  return longest > TITLE_TAG_HARD_MAX ? longest : undefined;
}

export const titleTagSpec: ColumnSpec = {
  id: "titleTag",
  kinds: ["product"],
  preserveRawAnswer: true,
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: describeColumn(ctx, "SEO title tag for this product page."),
    };
  },
  buildPromptSection(ctx) {
    const ownerLength = ownerTitleLength(ctx.col.customInstruction);
    return promptLine(
      ctx,
      "Write the SEO title tag (HTML <title>) for this product page.",
      [
        // The owner's own, longer length replaces the built-in search-engine length.
        ownerLength ? "" : `Aim for ${TITLE_TAG_TARGET} characters; never more than ${TITLE_TAG_HARD_MAX}.`,
        "Lead with the primary keyword, then brand and model when they are known; never invent either.",
        "Plain text only: no quotes, no HTML, no trailing brand separator unless the brand is known.",
      ]
    );
  },
  parseValue(raw, ctx) {
    const text = asTrimmedString(raw).replace(/\s+/g, " ");
    const limit = ctx.col.maxChars ?? ownerTitleLength(ctx.col.customInstruction) ?? TITLE_TAG_HARD_MAX;
    return clampChars(text, limit);
  },
};
