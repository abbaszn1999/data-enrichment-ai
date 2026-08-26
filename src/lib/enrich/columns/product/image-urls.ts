import { pickImagesFromSelection } from "../../tool-results";
import type { ColumnSpec, SpecContext } from "../types";
import { boundedCount, promptLine } from "../shared/helpers";

function imageLimit(ctx: SpecContext): number {
  return boundedCount(ctx.col.imageCount, 3);
}

export const imageUrlsSpec: ColumnSpec = {
  id: "imageUrls",
  kinds: ["product"],
  needs: { search: true, images: true },
  buildSchemaProperty(ctx) {
    return {
      type: "array",
      description:
        "Direct image file URLs only — copy image_url values from web_search image_result items. Never use source_website_url, HTML product pages, or invented URLs.",
      items: { type: "string" },
      maxItems: imageLimit(ctx),
    };
  },
  buildPromptSection(ctx) {
    return promptLine(
      ctx,
      "Find product images from the web using image search.",
      [
        `imageUrls are required: always use web_search with image results; pick up to ${imageLimit(
          ctx
        )} exact-product images.`,
        "Prefer official brand / manufacturer / reputable retailer packshots.",
        "CRITICAL: imageUrls must be the tool field image_url ONLY (direct image file URLs).",
        "NEVER put source_website_url, retailer product pages, or HTML catalogue links into imageUrls.",
        "Never invent image URLs; select only from web_search image_result.image_url values.",
      ]
    );
  },
  parseValue(raw, ctx) {
    return pickImagesFromSelection(raw, ctx.toolImages ?? [], imageLimit(ctx));
  },
};
