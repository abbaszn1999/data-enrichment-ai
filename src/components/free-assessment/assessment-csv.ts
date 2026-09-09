import type { MockCollection, MockNiche, NicheReading } from "./mock-data";

export type AssessmentPlpRow = {
  name: string;
  pageType: "collection" | "category" | "brand";
  skuCount: number;
  niche: string;
  description: string;
};

export type AssessmentCatalog = {
  niches: NicheReading[];
  structuredNiches: MockNiche[];
  collectionIds: string[];
  rowCount: number;
};

export const ASSESSMENT_CSV_TEMPLATE = `plp_name,page_type,sku_count,niche,description
Chargers and cables,collection,2441,Electronics,USB chargers cables and power adapters
Phone cases,collection,890,Electronics,Protective cases for phones
Wireless earbuds,collection,412,Electronics,
Ray-Ban,brand,120,Eyewear,Official Ray-Ban assortment
Sunglasses,category,3100,Eyewear,All sunglasses
Optical frames,collection,760,Eyewear,
Building blocks,collection,540,Toys,Construction and building sets
Outdoor play,category,210,Toys,
`;

const PAGE_TYPES = new Set(["collection", "category", "brand"]);

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "item"
  );
}

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
  const nicheIdx = headers.findIndex((h) =>
    ["niche", "parent_niche", "parent"].includes(h)
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
    const niche = (nicheIdx >= 0 ? cells[nicheIdx] ?? "" : "").trim();
    const description = (descIdx >= 0 ? cells[descIdx] ?? "" : "").trim();
    rows.push({
      name,
      pageType: PAGE_TYPES.has(pageType) ? pageType : "collection",
      skuCount,
      niche,
      description,
    });
  }

  if (rows.length === 0) {
    throw new Error("No PLP rows found in the sheet.");
  }
  return rows;
}

export function catalogFromAssessmentRows(rows: AssessmentPlpRow[]): AssessmentCatalog {
  const groups = new Map<string, AssessmentPlpRow[]>();
  for (const row of rows) {
    const key = row.niche.trim() || titleCase(row.pageType) || "Catalog";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const structuredNiches: MockNiche[] = [];
  const niches: NicheReading[] = [];
  const collectionIds: string[] = [];
  const usedIds = new Set<string>();

  for (const [nicheName, group] of groups) {
    const nicheId = uniqueId(slugify(nicheName), usedIds);
    const collections: MockCollection[] = group.map((row) => {
      const id = uniqueId(slugify(`${nicheName}-${row.name}`), usedIds);
      collectionIds.push(id);
      return {
        id,
        name: row.name,
        productCount: row.skuCount,
        description: row.description || undefined,
        kind: row.pageType === "brand" ? "brand" : "collection",
      };
    });
    const productCount = collections.reduce((sum, col) => sum + col.productCount, 0);
    structuredNiches.push({
      id: nicheId,
      name: nicheName,
      productCount,
      collections,
    });
    niches.push({
      id: nicheId,
      name: nicheName,
      summary: `${collections.length} PLP${collections.length === 1 ? "" : "s"} · ${productCount.toLocaleString("en-US")} SKUs in the uploaded sheet.`,
    });
  }

  return {
    niches,
    structuredNiches,
    collectionIds,
    rowCount: rows.length,
  };
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base || "item";
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function titleCase(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
