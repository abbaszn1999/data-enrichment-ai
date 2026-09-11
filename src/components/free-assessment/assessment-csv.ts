export type AssessmentPlpRow = {
  name: string;
  pageType: "collection" | "category" | "brand";
  skuCount: number;
  description: string;
};

export const ASSESSMENT_CSV_TEMPLATE = `plp_name,page_type,sku_count,description
Chargers and cables,collection,2441,USB chargers cables and power adapters
Phone cases,collection,890,Protective cases for phones
Wireless earbuds,collection,412,
Ray-Ban,brand,120,Official Ray-Ban assortment
Sunglasses,category,3100,All sunglasses
Optical frames,collection,760,
Building blocks,collection,540,Construction and building sets
Outdoor play,category,210,
`;

const PAGE_TYPES = new Set(["collection", "category", "brand"]);

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parsePageType(value: string): AssessmentPlpRow["pageType"] {
  const t = value.trim().toLowerCase();
  if (t === "brand" || t === "vendor") return "brand";
  if (t === "category" || t === "categories") return "category";
  return "collection";
}

export function parseAssessmentCsv(raw: string): AssessmentPlpRow[] {
  const lines = raw
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("The sheet needs a header row and at least one PLP.");
  }

  const headers = splitCsvLine(lines[0]!).map(normalizeHeader);
  const nameIdx = headers.findIndex((h) =>
    ["plp_name", "name", "plp", "page", "title", "collection"].includes(h)
  );
  const typeIdx = headers.findIndex((h) =>
    ["page_type", "type", "kind"].includes(h)
  );
  const skuIdx = headers.findIndex((h) =>
    ["sku_count", "skus", "product_count", "products", "count"].includes(h)
  );
  const descIdx = headers.findIndex((h) =>
    ["description", "desc", "notes"].includes(h)
  );

  if (nameIdx < 0) {
    throw new Error("Missing a PLP name column. Use plp_name in the header.");
  }

  const rows: AssessmentPlpRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = (cells[nameIdx] ?? "").replace(/^"|"$/g, "").trim();
    if (!name) continue;
    const skuRaw = skuIdx >= 0 ? cells[skuIdx] ?? "0" : "0";
    const skuCount = Math.max(0, Math.floor(Number(skuRaw.replace(/,/g, "")) || 0));
    const pageType = parsePageType(typeIdx >= 0 ? cells[typeIdx] ?? "" : "");
    const description = (descIdx >= 0 ? cells[descIdx] ?? "" : "").trim();
    rows.push({
      name,
      pageType: PAGE_TYPES.has(pageType) ? pageType : "collection",
      skuCount,
      description,
    });
  }

  if (rows.length === 0) {
    throw new Error("No PLP rows found in the sheet.");
  }
  return rows;
}

export function downloadAssessmentTemplate() {
  const blob = new Blob([ASSESSMENT_CSV_TEMPLATE], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "free-assessment-plp-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
