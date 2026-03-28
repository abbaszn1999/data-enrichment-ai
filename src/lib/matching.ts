export interface MatchingRule {
  type: string;
  enabled: boolean;
  label: string;
  description: string;
  value?: string;
  pattern?: string;
}

export const DEFAULT_MATCHING_RULES: MatchingRule[] = [
  { type: "trim_whitespace", enabled: true, label: "Trim Whitespace", description: "Remove spaces from both sides" },
  { type: "case_insensitive", enabled: true, label: "Case Insensitive", description: "Compare as lowercase" },
  { type: "ignore_prefix", enabled: false, label: "Ignore Prefix", description: "Remove prefix (e.g. '00')", value: "" },
  { type: "ignore_suffix", enabled: false, label: "Ignore Suffix", description: "Remove suffix (e.g. '-NEW')", value: "" },
  { type: "strip_non_alnum", enabled: false, label: "Strip Non-Alphanumeric", description: "Remove dashes, spaces, slashes" },
  { type: "regex_extract", enabled: false, label: "Regex Extract", description: "Extract matching portion", pattern: "" },
  { type: "contains", enabled: false, label: "Contains Match", description: "Check if supplier SKU contains master SKU" },
];

export function normalizeValue(value: string, rules: MatchingRule[]): string {
  let result = value;

  for (const rule of rules) {
    if (!rule.enabled) continue;

    switch (rule.type) {
      case "trim_whitespace":
        result = result.trim();
        break;
      case "case_insensitive":
        result = result.toLowerCase();
        break;
      case "ignore_prefix":
        if (rule.value && result.toLowerCase().startsWith(rule.value.toLowerCase())) {
          result = result.slice(rule.value.length);
        }
        break;
      case "ignore_suffix":
        if (rule.value && result.toLowerCase().endsWith(rule.value.toLowerCase())) {
          result = result.slice(0, -rule.value.length);
        }
        break;
      case "strip_non_alnum":
        result = result.replace(/[^a-zA-Z0-9]/g, "");
        break;
      case "regex_extract":
        if (rule.pattern) {
          try {
            const match = result.match(new RegExp(rule.pattern));
            if (match && match[0]) result = match[0];
          } catch {
            // Invalid regex, skip
          }
        }
        break;
    }
  }

  return result;
}

export function buildMasterIndex(
  masterSkus: { id: string; sku: string }[],
  rules: MatchingRule[]
): Map<string, { id: string; sku: string }[]> {
  const index = new Map<string, { id: string; sku: string }[]>();

  for (const product of masterSkus) {
    const normalized = normalizeValue(product.sku, rules);
    const existing = index.get(normalized) || [];
    existing.push(product);
    index.set(normalized, existing);
  }

  return index;
}

export interface MatchResult {
  rowIndex: number;
  supplierSku: string;
  normalizedSku: string;
  matchType: "existing" | "new" | "ambiguous";
  matchedProductId?: string;
  matchedProductSku?: string;
  confidence: number;
  allMatches?: { id: string; sku: string }[];
}

export function matchSupplierRows(
  supplierRows: { rowIndex: number; sku: string; data: Record<string, any> }[],
  masterIndex: Map<string, { id: string; sku: string }[]>,
  rules: MatchingRule[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const containsRule = rules.find((r) => r.type === "contains" && r.enabled);

  for (const row of supplierRows) {
    const normalized = normalizeValue(row.sku, rules);
    let matches = masterIndex.get(normalized);

    // Try contains match if exact match fails
    if (!matches && containsRule) {
      const found: { id: string; sku: string }[] = [];
      for (const [masterNorm, products] of masterIndex) {
        if (normalized.includes(masterNorm) || masterNorm.includes(normalized)) {
          found.push(...products);
        }
      }
      if (found.length > 0) matches = found;
    }

    if (!matches || matches.length === 0) {
      results.push({
        rowIndex: row.rowIndex,
        supplierSku: row.sku,
        normalizedSku: normalized,
        matchType: "new",
        confidence: 0,
      });
    } else if (matches.length === 1) {
      results.push({
        rowIndex: row.rowIndex,
        supplierSku: row.sku,
        normalizedSku: normalized,
        matchType: "existing",
        matchedProductId: matches[0].id,
        matchedProductSku: matches[0].sku,
        confidence: 1.0,
      });
    } else {
      results.push({
        rowIndex: row.rowIndex,
        supplierSku: row.sku,
        normalizedSku: normalized,
        matchType: "ambiguous",
        confidence: 0.5,
        allMatches: matches,
      });
    }
  }

  return results;
}

export function generateDiff(
  supplierData: Record<string, any>,
  masterData: Record<string, any>,
  columnMapping: Record<string, string>
): Record<string, { old: string; new: string }> {
  const diff: Record<string, { old: string; new: string }> = {};

  for (const [supplierCol, systemCol] of Object.entries(columnMapping)) {
    if (systemCol === "sku") continue; // Don't diff the match column
    const newVal = String(supplierData[supplierCol] ?? "");
    const oldVal = String(masterData[systemCol] ?? "");
    if (newVal && newVal !== oldVal) {
      diff[systemCol] = { old: oldVal, new: newVal };
    }
  }

  return diff;
}
