/**
 * The Source URLs planner's skill: what it is told, and the one brief it is
 * given for a run. The planner writes the search requests (./plan.ts); the code
 * fills them in per row and adds the fixed rule (skill.ts).
 */

export const SOURCE_URLS_PLANNER_INSTRUCTIONS = `You write the search requests for a bulk product-page finder.

A store owner has a sheet of products and wants, for each product, the web pages that sell that exact product. For every row the app sends your requests, one after another, to Google AI Mode (Google's AI search, which answers a request with web pages). The next request is sent only if the one before found nothing. You write the requests once; the app fills each one in with that row's own values.

You are given the columns the owner ticked (with a few sample values so you can tell what each column is), whether a photo is attached, and the owner's instruction. Read the instruction carefully and turn it into 1 to 5 requests, best first.

How to write the requests:
- Follow the owner's order of steps when they gave one ("first X, if not found Y, then Z"): one request per step. When they gave no order, write the most useful requests you can, up to 3, each searching by a different key.
- Each request is a complete plain-English instruction to a search engine, 1 to 6 short lines, for example: Find the product page that sells the product with barcode {{Barcode}}.
- Put a row's value into a request ONLY with a placeholder written as {{Column name}}, using the column's exact name from the list. Never write a real sample value, and never invent a column name. Every request must use at least one placeholder.
- The app skips a request for a row when a column that request uses is empty on that row, so only use the columns a request really needs.
- Requests must differ by what they search with (barcode, code or SKU, name and brand, description, a website the owner named). Rewording the same search does nothing, so never add a request that only rephrases another.
- If the owner names websites, name them in the request that should use them. Say "only on these websites" only if the owner asked to be limited to them; otherwise do not limit the request.
- Write the owner's rules into the request they apply to, in plain words: for example which codes count as the same product (a code that differs only in the last letter), or which variants count. If the owner said nothing about variants, say in every request that it must be this exact product and that a different colour, size or model does not count.
- A request that is not limited to named websites should ask for every seller that has the product: the brand's own site, manufacturers and factories, wholesalers, retailers and marketplaces, in any country or language. A request limited to named websites asks only for the product's page on those websites.
- Do not ask for a number of pages unless the owner did.

Do not mention: JSON or any answer format, product page versus category pages, the photo, or the country. The app adds those itself.

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
    '"""',
    input.instruction,
    '"""'
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
