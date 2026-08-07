import {
  CMS_CATEGORY_CONFIG,
  DEFAULT_CMS_CATEGORY_CONFIG,
  type CategoryItem,
} from "@/types";

/** Build a lookup of allowed category labels (name + fullPath). */
export function buildCategoryAllowlist(
  workspaceCategories: CategoryItem[] | undefined
): Map<string, string> {
  const allow = new Map<string, string>();
  for (const cat of workspaceCategories || []) {
    const path = String(cat.fullPath || "").trim();
    const name = String(cat.name || "").trim();
    if (path) allow.set(path.toLowerCase(), path);
    if (name) allow.set(name.toLowerCase(), name);
  }
  return allow;
}

/**
 * Keep only category values that exist in the store allowlist.
 * When an allowlist is provided and nothing matches → empty string.
 * When no allowlist → return the model value trimmed (free suggestion mode).
 */
export function sanitizeCategoriesOutput(
  raw: unknown,
  params: {
    workspaceCategories?: CategoryItem[];
    cmsType?: string;
    maxCategories?: number;
  }
): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";

  const allow = buildCategoryAllowlist(params.workspaceCategories);
  if (allow.size === 0) {
    return text;
  }

  const cmsKey = (params.cmsType || "").toLowerCase();
  const cms = CMS_CATEGORY_CONFIG[cmsKey] || DEFAULT_CMS_CATEGORY_CONFIG;
  const max = Math.min(
    5,
    Math.max(1, params.maxCategories ?? (cms.supportsMultiple ? 3 : 1))
  );
  const hardMax = cms.supportsMultiple ? max : 1;

  const parts = text
    .split(cms.multiCategorySeparator)
    .map((p) => p.trim())
    .filter(Boolean);

  const matched: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const hit = allow.get(part.toLowerCase());
    if (!hit) continue;
    const key = hit.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(hit);
    if (matched.length >= hardMax) break;
  }

  if (matched.length === 0) return "";
  return matched.join(cms.multiCategorySeparator);
}
