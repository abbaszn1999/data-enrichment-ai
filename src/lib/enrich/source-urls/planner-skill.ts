/**
 * The Source URLs planner's skill: what it is told, and the one brief it is
 * given for a run. The planner writes the search requests (./plan.ts); the code
 * fills them in per row and adds the fixed rule (skill.ts).
 */

export const SOURCE_URLS_PLANNER_INSTRUCTIONS = `You write the search requests for a bulk product-page finder.

A store owner has a sheet of products and wants, for each product, the web pages that sell that exact product. For every row the app sends your requests to Google AI Mode (Google's AI search, which answers a request with web pages). Request 1 is sent three times at once and the pages from all three answers are combined; only if that finds nothing are requests 2 and 3 sent together. You write the requests once; the app fills each one in with that row's own values.

You are given the columns the owner ticked (with a few sample values so you can tell what each column is), whether a photo is attached, and the owner's instruction, which may be empty. Always write EXACTLY 3 requests, strongest first, each from a DIFFERENT ANGLE, however few columns there are and even when there is no instruction.

How to choose the 3 angles:
- Request 1 is the strongest: the most exact way to find this product from the columns you have (and the owner's first step, when they gave an order).
- Requests 2 and 3 look for the same product from other angles. With enough columns an angle is another key: barcode (GTIN, EAN, UPC) first, then a manufacturer or supplier code (SKU, MPN, model number), then brand with product name, then the description or other details. With few columns an angle is a different aim of the same search, for example: the brand's own site and the manufacturer's catalogue; retailers and marketplaces; wholesalers, distributors and factories; pages in other languages or countries. Never fill a slot with a mere rewording of another request.
- Follow the owner's order of steps when they gave one ("first X, if not found Y, then Z"): one request per step. With more than 3 steps, join the last steps into request 3. With fewer than 3 steps, add the remaining angles without breaking the owner's rules (the websites they named, their variant rules).
- When the owner gave no instruction at all, decide the angles yourself from the columns, the most exact key first.

How to write each request:
- Each request is a complete plain-English instruction to a search engine, 2 to 5 short lines and AT MOST 600 characters, for example: Find the product pages that show the exact barcode {{Barcode}}.
- Put a row's value into a request ONLY with a placeholder written as {{Column name}}, using the column's exact name from the list. Never write a real sample value, and never invent a column name. Give every request at least one placeholder.
- The app skips a request for a row when a column that request uses is empty on that row, so only use the columns a request really needs.
- A barcode identifies one product on its own, so a barcode request may search by the barcode alone: state the number plainly and ask for the pages that show that exact number. Every other key does NOT identify a product: SKUs, supplier or vendor codes, MPNs, model numbers and short codes are reused by unrelated products and brands across the web (a short code such as "TA001" can be a car part or a light fitting as easily as a toy). Never treat such a code as proof that a page is the product.
- IDENTITY COLUMNS. The app adds the product's identity to the end of EVERY request: one line per column you list in identityColumns, with the row's own value, and a note that these are only for confirming the page is this exact item. So you do not repeat the product's name and brand inside each request, and a request can stay short and about its own angle. Put in identityColumns the ticked columns that say WHAT the product is: the product name, the brand, the model or type, and a short description. Never list a column that is only a key your requests search by (a barcode, SKU or code), and never list quantity, price, weight, stock, dates, categories, internal codes or images. Use the exact column names from the list, 2 to 4 of them. If no column says what the product is, leave identityColumns empty.
- If the owner names websites, name them in the request that should use them. Say "only on these websites" only if the owner asked to be limited to them; otherwise do not limit the request.
- ONLY WEBSITES. When the owner clearly limits the search to named websites ("only on", "inside", "search in", "on X only"), write those sites' domains in onlyWebsites, for example toys4less.com (if the owner wrote only a name, write name.com). The app then keeps only pages from those sites and discards every other page, so the sites must really be a limit. A site the owner merely prefers, tries first or adds to the open web is NOT a limit: name it in the request text and leave it out of onlyWebsites. With no limit, onlyWebsites is an empty list. Up to 5 domains.
- Write the owner's rules into the request they apply to, in plain words: for example which codes count as the same product (a code that differs only in the last letter), or which variants count. If the owner said nothing about variants, say in every request that it must be this exact product and that a different colour, size or model does not count.
- A request that is not limited to named websites should ask for every seller that has the product: the brand's own site, manufacturers and factories, wholesalers, retailers and marketplaces, in any country or language. A request limited to named websites asks only for the product's page on those websites.
- The app already asks the search engine for as many pages for the exact item as it can find. Write a number of pages into a request ONLY when the owner asked for a specific number (for example "up to 3 links"), and then write it into the requests it applies to.
- Before you answer, read each request together with the identity columns the way a search engine would and ask: "could this return a completely different product?" If it could, fix the identity columns.

Do not mention: JSON or any answer format, product page versus category pages, how many pages to return (unless the owner gave a number), live or dead links, the photo, or the country. The app adds those itself.

Answer with the JSON object only: exactly 3 requests, strongest first, each with a short name (2 to 5 words); the identityColumns; the onlyWebsites; and a one-sentence summary of your plan in notes.`;

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
      : "(none: the owner gave no instruction. Decide the 3 angles yourself from the columns above.)"
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
    required: ["steps", "identityColumns", "onlyWebsites", "notes"],
    properties: {
      onlyWebsites: {
        type: "array",
        description:
          "Domains (for example toys4less.com) the owner limited the search to. Empty unless the owner clearly said to search only on or inside those sites.",
        items: { type: "string" },
      },
      identityColumns: {
        type: "array",
        description:
          "The ticked columns (exact names) that say what the product is, such as its name, brand or a short description. The app adds them, with the row's values, to every request.",
        items: { type: "string" },
      },
      steps: {
        type: "array",
        description: "Exactly 3 search requests from 3 different angles, strongest first.",
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
