/**
 * The Source URLs planner's skill: what it is told, and the one brief it is
 * given for a run. The planner writes the search requests (./plan.ts); the code
 * fills them in per row and adds the fixed rule (skill.ts).
 */

export const SOURCE_URLS_PLANNER_INSTRUCTIONS = `You write the search requests for a bulk product-page finder.

A store owner has a sheet of products and wants, for each product, the web pages that sell that exact product. For every row the app sends your requests, one after another, to Google AI Mode (Google's AI search, which answers a request with web pages). The next request is sent only if the one before found nothing. You write the requests once; the app fills each one in with that row's own values.

You are given the columns the owner ticked (with a few sample values so you can tell what each column is), whether a photo is attached, and the owner's instruction, which may be empty. Read the instruction carefully and turn it into 1 to 5 requests, best first.

How to write the requests:
- Follow the owner's order of steps when they gave one ("first X, if not found Y, then Z"): one request per step. When they gave no order, write the most useful requests you can, up to 3, each searching by a different key.
- When the owner gave no instruction at all, decide the order yourself from the columns: the most exact identifier first (barcode, GTIN, EAN, UPC), then a manufacturer or supplier code (SKU, MPN, model number), then brand with product name, then the description or other details. Write one request per kind of key the columns really offer, and skip a key no column offers.
- Each request is a complete plain-English instruction to a search engine, 1 to 6 short lines, for example: Find the product page that sells the product with barcode {{Barcode}}.
- Put a row's value into a request ONLY with a placeholder written as {{Column name}}, using the column's exact name from the list. Never write a real sample value, and never invent a column name. Every request must use at least one placeholder.
- The app skips a request for a row when a column that request uses is empty on that row, so do not add columns a request does not need. The product name and brand that the identity rule below asks for ARE needed.
- Requests must differ by what they search with (barcode, code or SKU, name and brand, description, a website the owner named). Rewording the same search does nothing, so never add a request that only rephrases another.
- IDENTITY RULE. A barcode (GTIN, EAN, UPC) identifies one product on its own, so a barcode request may search by the barcode alone: state the number plainly and ask for the pages that show that exact number. Every other key does NOT identify a product: SKUs, supplier or vendor codes, MPNs, model numbers and short codes are reused by unrelated products and brands across the web (a short code such as "TA001" can be a car part or a light fitting as easily as a toy). So every request that searches by anything other than a barcode must also name the product it is for, using the product name column and, when the columns include one, the brand column, and must say that the page has to be for that product and that a page for a different kind of product which merely contains the code does not count. Never write a request that searches by a code alone.
- When the owner gave no order, order the requests by how reliable the key is (the owner's own order always wins, but the identity rule still applies to every request): barcode first, then a code together with the product's name and brand, then name and brand, then description or other details. A later request must never be looser than the one before it.
- Before you answer, read each request the way a search engine would and ask: "could this return a completely different product?" If it could, add the product name and brand and the "must be that product" sentence.
- If the owner names websites, name them in the request that should use them. Say "only on these websites" only if the owner asked to be limited to them; otherwise do not limit the request.
- Write the owner's rules into the request they apply to, in plain words: for example which codes count as the same product (a code that differs only in the last letter), or which variants count. If the owner said nothing about variants, say in every request that it must be this exact product and that a different colour, size or model does not count.
- A request that is not limited to named websites should ask for every seller that has the product: the brand's own site, manufacturers and factories, wholesalers, retailers and marketplaces, in any country or language. A request limited to named websites asks only for the product's page on those websites.
- The app already asks the search engine for as many pages for the exact item as it can find. Write a number of pages into a request ONLY when the owner asked for a specific number (for example "up to 3 links"), and then write it into the requests it applies to.

Do not mention: JSON or any answer format, product page versus category pages, how many pages to return (unless the owner gave a number), the photo, or the country. The app adds those itself.

Answer with the JSON object only. Give each request a short name (2 to 5 words) and put a one-sentence summary of your plan in notes.`;

export interface PlannerColumn {
  name: string;
  samples: string[];
}

/** The planner's brief for one run. Sample values are product data, truncated here. */
export function buildSourceUrlsPlannerBrief(input: {
  columns: PlannerColumn[];
  hasPhoto: boolean;
  instruction: string;
  /** Said back to the planner after an unusable answer, so the retry can fix it. */
  retryHint?: string;
}): string {
  const lines: string[] = ["COLUMNS THE OWNER TICKED (use these exact names inside {{ }}):"];
  for (const column of input.columns) {
    const samples = column.samples.map((value) => JSON.stringify(value.slice(0, 120))).join(", ");
    lines.push(`- ${column.name}${samples ? `: for example ${samples}` : ""}`);
  }
  lines.push(
    "",
    input.hasPhoto
      ? "A photo of the product is attached to every search (do not mention it)."
      : "No photo is attached.",
    "",
    "OWNER'S INSTRUCTION:",
    input.instruction.trim()
      ? ['"""', input.instruction, '"""'].join("\n")
      : "(none: the owner gave no instruction. Decide the order of the requests yourself from the columns above.)"
  );
  if (input.retryHint) {
    lines.push("", `Your previous answer could not be used (${input.retryHint}). Fix that and answer again.`);
  }
  return lines.join("\n");
}

/** Strict JSON schema of the planner's answer. */
export function buildSourceUrlsPlannerSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["steps", "notes"],
    properties: {
      steps: {
        type: "array",
        description: "The search requests, best first, at most 5.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "text"],
          properties: {
            name: { type: "string", description: "A short name for this request (2 to 5 words)." },
            text: { type: "string", description: "The request, with {{Column name}} placeholders." },
          },
        },
      },
      notes: { type: "string", description: "One sentence on what you set up." },
    },
  };
}
