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

export const titleTagSpec: ColumnSpec = {
  id: "titleTag",
  kinds: ["product"],
  buildSchemaProperty(ctx) {
    return {
      type: "string",
      description: describeColumn(ctx, "SEO title tag for this product page."),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Write the SEO title tag (HTML <title>) for this product page.",
      [
        `Aim for ${TITLE_TAG_TARGET} characters; never more than ${TITLE_TAG_HARD_MAX}.`,
        "Lead with the primary keyword, then brand and model when they are known; never invent either.",
        "Plain text only: no quotes, no HTML, no trailing brand separator unless the brand is known.",
      ]
    );
  },
  parseValue(raw, ctx) {
    const text = asTrimmedString(raw).replace(/\s+/g, " ");
    return clampChars(text, ctx.col.maxChars ?? TITLE_TAG_HARD_MAX);
  },
};
