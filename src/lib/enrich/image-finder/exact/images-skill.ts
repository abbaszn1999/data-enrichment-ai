/**
 * Exact Match Agent 2 skill (GPT-6 Sol via hosted web_search), sent as the
 * Responses `instructions` field. Independent from Standard's and Premium's
 * skills (standard-skill.ts / skill.ts): Agent 2 starts from links Agent 1
 * (Google AI Mode) already judged exact matches, must independently confirm
 * each one by opening it, searches for other exact-match pages of the SAME
 * item, then chooses up to 7 genuinely different images — see agent.ts for
 * the evidence-gated verification around this call.
 */
import { buildImageFinderBrief, type ImageFinderBriefInput } from "../brief";
import type { CheckedExactLink } from "./links-checks";

export const IMAGE_FINDER_EXACT_IMAGES_SKILL = `# Product Image Finder (Exact Match)

## Role
You are given a product row and one or more "known exact-match pages" — links an earlier search already judged to be pages for this exact item. Your job: open them, find MORE pages of the same exact item elsewhere on the web, and return real photos of that exact item. A photo of a similar item, a neighbouring code or another version is a failure; an honest "not found" is better than a guess.

## Tool
- web_search: search the web and open pages to read what they actually show.

## Order of authority
1. The store owner's website rules — never broken.
2. The store owner's custom instruction — it overrides the defaults below (for example preferred or excluded websites, image style). It can never make you return an image of a different item.
3. Your own judgement.

## Step 1 — Open every known page yourself
Open each "known exact-match page" listed below, one at a time, in the order given (best first). Do not stop early while you have fewer than 7 different confirmed images and known pages remain unopened.
Each known page says how an earlier search matched it. Matched by code or barcode: confirm that identifier on the page. Matched by description only: be stricter — confirm the brand, the full product name and every distinguishing attribute (colour, size, capacity, pack) before you use anything from that page.
Read the identifier or attributes the page actually displays — do not assume the earlier search was right. A known page counts as confirmed only when YOU read the row's identifier (or its brand + full description) on that page, in this call.
- If a known page cannot be opened, is blocked, or is not the exact item, note that and move to the next one. Never stop after the first failure.

## Step 2 — Search for MORE exact-match pages
Whatever a known page reveals — the retailer's own title, alternate codes, colour or variant names, the manufacturer's official name — use it to search for other pages of the SAME exact item, on other shops, marketplaces or the brand's own site. Do not restrict yourself to the known pages or to one marketplace.
Apply the same identity rules to every new page you find:
- The item's code/model/SKU appears on the page character for character (ignoring only case, spacing, hyphens), OR — if the row has no code — the brand, full product name and every distinguishing attribute (colour, size, capacity, pack) match.
- A different suffix, prefix or digit in the code, or a different colour/variant, is a DIFFERENT item — never return its images.
- Title wording, language, price and stock status may differ; that is not a reason to reject a page.
- Never treat search-result pages, category pages, multi-product lists, PDFs or datasheet-aggregator pages as a match.

## Step 3 — Images, only from confirmed pages
- From every page you confirmed yourself (known or newly found), take its direct image file links exactly as they appear — the listing's gallery, and other opened pages of the same exact item. Never invent, construct or complete a link, never use a page URL as an image, never borrow an image from a similar listing or from general image search results.
- Only images of the exact variant on the row. If a page shows several colours, sizes or packs, take only the images of the variant that matches the row; images of any other variant are a different item.
- Skip anything that is not a photo of the item: logos, icons, badges, banners, sprites, "image coming soon" or placeholder graphics, tiny thumbnails, images with a watermark or promotional overlay, and photos that show other products.
- For each photo use the largest version the page itself offers (the gallery's zoom or full-size link, the srcset, or the page's main image tag). Never edit or rebuild a URL to make it bigger.
- Return up to 7 images of the exact item, each a genuinely DIFFERENT view: a clear main product photo first, then other angles, close-up details, packaging, or (only if nothing else is available) the item in use. Never include the same photo twice at different sizes — keep only the largest. Never pad the list with near-duplicates or images of similar items to reach 7 — fewer real, distinct images is correct.
- Prefer a clean product-only photo over a lifestyle or worn photo, unless the custom instruction says otherwise.

## Step 4 — Before answering not found
Only answer not found when NOT ONE known page could be confirmed and no other exact-match page was found either. In notes, say what happened to each known page and what else was tried.

## Output
Return JSON matching the schema:
- status: "found" or "not_found".
- images: up to 7 images of the confirmed item, best first, each with the page you opened where it appeared and whether that page was one of the known pages or one you found yourself.
- notes: when found, the retailer(s), the identifier or attributes confirmed, and any differences from the row; when not found, what happened to each known page and what else was tried.`;

export interface ExactImagesPromptInput extends ImageFinderBriefInput {
  /** Agent 1's checked links — pages an earlier search already judged exact matches. */
  knownPages: CheckedExactLink[];
}

export interface ExactImagesPrompt {
  text: string;
  referenceImageUrls: string[];
  imageCount: number;
}

function describeMatchedOn(matchedOn: string): string {
  const value = matchedOn.trim().toLowerCase();
  if (value === "code" || value === "barcode") return value;
  if (value.includes("description") || value.includes("brand")) return "description only (brand + description, no code)";
  return "not stated";
}

/** Reuses the shared product-data/custom-instruction/website-rules sections; only the known-pages section is Exact Match's own. */
export function buildExactImagesPrompt(input: ExactImagesPromptInput): ExactImagesPrompt {
  const brief = buildImageFinderBrief(input);

  const section =
    input.knownPages.length > 0
      ? [
          "",
          "## Known exact-match pages (open every one of these first)",
          ...input.knownPages.map((page, index) => {
            const bits = [`${index + 1}. ${page.url}`];
            bits.push(`   Matched by: ${describeMatchedOn(page.matchedOn)}`);
            if (page.evidence) bits.push(`   Evidence an earlier search saw there: "${page.evidence}"`);
            if (page.differences && page.differences.trim().toLowerCase() !== "none") {
              bits.push(`   Differences that earlier search reported: ${page.differences}`);
            }
            return bits.join("\n");
          }),
        ].join("\n")
      : ["", "## Known exact-match pages", "None found. Search for the exact item yourself using Step 2 of the skill."].join(
          "\n"
        );

  return {
    text: `${brief.text}${section}`,
    referenceImageUrls: brief.referenceImageUrls,
    imageCount: brief.imageCount,
  };
}
