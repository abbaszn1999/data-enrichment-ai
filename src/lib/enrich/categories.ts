import {
  CMS_CATEGORY_CONFIG,
  DEFAULT_CMS_CATEGORY_CONFIG,
  type CategoryFormat,
  type CategoryItem,
} from "@/types";
import {
  categoryFormatDepth,
  categoryStructureFor,
  resolveCategoryFormat,
  type CategoryStructure,
} from "@/lib/categories/format";

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

const HIERARCHY = " > ";
const OUTPUT_SEPARATOR = ", ";
const MAX_CATEGORIES_LIMIT = 5;

/** What one Categories run does with the store's list and the platform. */
export interface CategoryPlan {
  /** "store": pick from the store's own list. "suggest": the agent proposes categories. */
  mode: "store" | "suggest";
  structure: CategoryStructure;
  format: CategoryFormat;
  /** Deepest path the agent may write when suggesting. */
  depth: number;
  /** Most categories (or paths) written per product. */
  max: number;
  /** Store mode: every allowed label (a name for flat platforms, a full path for trees), sorted. */
  labels: string[];
}

export function resolveCategoryPlan(params: {
  cmsType?: string;
  workspaceCategories?: CategoryItem[];
  maxCategories?: number;
  categoryFormat?: CategoryFormat | string;
  useStoreCategories?: boolean;
}): CategoryPlan {
  const structure = categoryStructureFor(params.cmsType);
  const format = resolveCategoryFormat(params.cmsType, params.categoryFormat);
  const wantsStore = params.useStoreCategories !== false;

  const seen = new Set<string>();
  const labels: string[] = [];
  if (wantsStore) {
    for (const cat of params.workspaceCategories ?? []) {
      const label = (structure === "flat" ? cat.name : cat.fullPath || cat.name)?.trim();
      if (!label || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      labels.push(label);
    }
    labels.sort((a, b) => a.localeCompare(b));
  }

  const cms = CMS_CATEGORY_CONFIG[(params.cmsType || "").toLowerCase()] || DEFAULT_CMS_CATEGORY_CONFIG;
  const fallbackMax = cms.supportsMultiple ? 3 : 1;
  const requested = Number.isFinite(params.maxCategories) ? Number(params.maxCategories) : fallbackMax;
  return {
    mode: labels.length > 0 ? "store" : "suggest",
    structure,
    format,
    depth: categoryFormatDepth(format),
    max: Math.min(MAX_CATEGORIES_LIMIT, Math.max(1, Math.round(requested))),
    labels,
  };
}

/**
 * The stable part of the request (sent as the Responses `instructions`): the
 * rules, the output format, and the full store list. It is identical for every
 * row of a run, so OpenAI's prompt cache serves it at the cached-input price.
 */
export function buildCategoryInstructions(
  plan: CategoryPlan,
  options: { language?: string; customInstruction?: string } = {}
): string {
  const language = options.language || "English";
  const lines: string[] = [
    "You assign ONE ecommerce product to categories, using only the product data you are given.",
    "Do not browse the web. Decide from the product's title, type, brand, description and other fields.",
    "Return ONLY the JSON fields requested.",
    "",
  ];

  if (plan.mode === "store") {
    if (plan.structure === "flat") {
      lines.push(
        "STORE COLLECTIONS. The store groups products into flat collections (there are no parent collections and no paths).",
        `Choose up to ${plan.max} collection${plan.max === 1 ? "" : "s"} from the list below, best fit first.`,
        "Copy each collection name EXACTLY as listed. Never invent, translate, shorten or reword a name.",
        `Write the chosen names separated by "${OUTPUT_SEPARATOR}".`
      );
    } else {
      lines.push(
        "STORE CATEGORIES. The store's categories form a tree. Each line below is one category written as its full path, parent first, levels joined by \" > \".",
        `Choose up to ${plan.max} path${plan.max === 1 ? "" : "s"} from the list, best fit first.`,
        "Choose the MOST SPECIFIC path that fits. Choose a parent path only when none of its children fits the product.",
        "Copy each path EXACTLY as listed, all levels included. Never mix levels from different paths, and never invent, translate or reword a category.",
        `Write the chosen paths separated by "${OUTPUT_SEPARATOR}".`
      );
    }
    lines.push(
      'If no category in the list reasonably fits, return "" for categories and say why in one short sentence in "reason".',
      ""
    );
  } else {
    if (plan.format === "collections" || plan.format === "flat") {
      lines.push(
        plan.format === "collections"
          ? "The store has no collections yet. Suggest collections for this product: flat, short, reusable names a shopper would browse (for example \"Running Shoes\", \"Summer Sale\"), with no parents and no \" > \" paths."
          : "The store has no categories yet. Suggest flat categories for this product: short, reusable names with no parents and no \" > \" paths.",
        `Suggest up to ${plan.max} name${plan.max === 1 ? "" : "s"}, best fit first, separated by "${OUTPUT_SEPARATOR}".`,
        "Names must not contain commas."
      );
    } else {
      lines.push(
        `The store has no categories yet. Suggest a category path for this product with at most ${plan.depth} levels, general to specific, levels joined by "${HIERARCHY}" (for example ${
          plan.depth === 2 ? '"Shoes > Sneakers"' : '"Shoes > Sneakers > Running Sneakers"'
        }).`,
        plan.depth === 2
          ? "Use two levels when the product has a natural sub category, otherwise one."
          : "Use as many levels as make sense (one to three); never more than three.",
        `Suggest up to ${plan.max} path${plan.max === 1 ? "" : "s"}, best fit first, separated by "${OUTPUT_SEPARATOR}". Names must not contain commas.`
      );
    }
    lines.push(
      "Use broad, reusable names (many products share a category), never a product name or model number.",
      `Write category names in ${language}.`,
      ""
    );
  }

  const custom = options.customInstruction?.trim();
  if (custom) {
    lines.push("Store owner's instruction (follow it when it does not break the rules above):", custom, "");
  }

  if (plan.mode === "store") {
    lines.push(
      plan.structure === "flat" ? `Allowed collections (${plan.labels.length}):` : `Allowed categories (${plan.labels.length}):`,
      ...plan.labels
    );
  }
  return lines.join("\n");
}

/** Strict JSON schema of a Categories-mode answer. */
export function buildCategoriesSchema(plan: CategoryPlan): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      categories: {
        type: "string",
        description:
          plan.mode === "store"
            ? `Up to ${plan.max} entries copied exactly from the allowed list, separated by "${OUTPUT_SEPARATOR}". Empty string if none fit.`
            : `Up to ${plan.max} suggested ${plan.depth > 1 ? "paths" : "names"}, separated by "${OUTPUT_SEPARATOR}".`,
      },
      reason: {
        type: "string",
        description: "Only when categories is empty: one short sentence saying why nothing fits. Otherwise an empty string.",
      },
    },
    required: ["categories", "reason"],
  };
}

const PIECE_BREAK = /[,;\n]/;

function normalizeArrows(value: string): string {
  return value.replace(/[ \t]*(?:>|›|»)[ \t]*/g, HIERARCHY).replace(/[ \t]+/g, " ").trim();
}

/** Comparison key for a label or a piece of the answer. */
function comparable(value: string, structure: CategoryStructure): string {
  return (structure === "tree" ? normalizeArrows(value) : value.replace(/[ \t]+/g, " ").trim()).toLowerCase();
}

/**
 * Splits a model answer against the allowed labels. Labels may contain commas
 * ("Pots, Pans & Lids"), so at each position the longest label that starts
 * there and ends at a separator wins before falling back to a plain split.
 */
function splitAgainstLabels(text: string, labelsLower: string[]): Array<{ label?: string; piece: string }> {
  const out: Array<{ label?: string; piece: string }> = [];
  const byLength = [...labelsLower].sort((a, b) => b.length - a.length);
  let rest = text.trim();
  while (rest) {
    const lower = rest.toLowerCase();
    const hit = byLength.find((label) => {
      if (!lower.startsWith(label)) return false;
      const after = rest.slice(label.length).trimStart();
      return after === "" || PIECE_BREAK.test(after[0]);
    });
    if (hit) {
      out.push({ label: hit, piece: rest.slice(0, hit.length) });
      rest = rest.slice(hit.length).replace(/^\s*[,;\n]\s*/, "");
      continue;
    }
    const cut = rest.search(PIECE_BREAK);
    const piece = (cut === -1 ? rest : rest.slice(0, cut)).trim();
    if (piece) out.push({ piece });
    rest = cut === -1 ? "" : rest.slice(cut + 1).trim();
  }
  return out;
}

/** Drops a path when a longer chosen path already continues it ("A" next to "A > B"). */
function dropCoveredAncestors(values: string[]): string[] {
  return values.filter(
    (value) =>
      !values.some(
        (other) => other !== value && other.toLowerCase().startsWith(`${value.toLowerCase()}${HIERARCHY}`)
      )
  );
}

export interface ParsedCategories {
  /** What is stored in the Categories column ("" when nothing usable). */
  value: string;
  /** Why the value is empty; "" when it is not. */
  note: string;
}

/**
 * Turns the model's answer into the stored value.
 * - store mode: only entries that exist in the store list survive (exact, or a leaf name that maps to one path);
 * - suggest mode: paths are normalised, cut to the chosen depth, deduplicated and capped.
 */
export function parseCategoryAnswer(rawValue: unknown, plan: CategoryPlan, modelReason?: unknown): ParsedCategories {
  const text = String(rawValue ?? "").trim();
  const reason = String(modelReason ?? "").trim();
  if (!text) {
    return {
      value: "",
      note: plan.mode === "store" ? reason || "No store category fits this product." : reason || "No category could be suggested.",
    };
  }

  if (plan.mode === "suggest") {
    const chosen: string[] = [];
    const seen = new Set<string>();
    for (const piece of text.split(PIECE_BREAK)) {
      const levels = normalizeArrows(piece)
        .split(HIERARCHY)
        .map((level) => level.trim())
        .filter(Boolean);
      if (levels.length === 0) continue;
      const kept = plan.depth <= 1 ? [levels[levels.length - 1]] : levels.slice(0, plan.depth);
      const path = kept.join(HIERARCHY);
      if (seen.has(path.toLowerCase())) continue;
      seen.add(path.toLowerCase());
      chosen.push(path);
    }
    const value = dropCoveredAncestors(chosen).slice(0, plan.max).join(OUTPUT_SEPARATOR);
    return { value, note: value ? "" : reason || "No category could be suggested." };
  }

  // Store mode.
  const labelByLower = new Map<string, string>();
  for (const label of plan.labels) labelByLower.set(comparable(label, plan.structure), label);
  const leafToLabels = new Map<string, string[]>();
  if (plan.structure === "tree") {
    for (const label of plan.labels) {
      const leaf = label.split(HIERARCHY).pop()?.trim().toLowerCase();
      if (!leaf) continue;
      leafToLabels.set(leaf, [...(leafToLabels.get(leaf) ?? []), label]);
    }
  }

  const normalizedText = plan.structure === "tree" ? normalizeArrows(text) : text.replace(/[ \t]+/g, " ");
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const { label, piece } of splitAgainstLabels(normalizedText, [...labelByLower.keys()])) {
    const key = label ?? comparable(piece, plan.structure);
    let hit = labelByLower.get(key);
    if (!hit) {
      const leaves = leafToLabels.get(key);
      if (leaves?.length === 1) hit = leaves[0];
    }
    if (!hit || seen.has(hit.toLowerCase())) continue;
    seen.add(hit.toLowerCase());
    matched.push(hit);
  }

  const kept = (plan.structure === "tree" ? dropCoveredAncestors(matched) : matched).slice(0, plan.max);
  if (kept.length === 0) {
    return {
      value: "",
      note: reason || `"${text.slice(0, 120)}" is not in your store categories, so nothing was assigned.`,
    };
  }
  return { value: kept.join(OUTPUT_SEPARATOR), note: "" };
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
    categoryFormat?: CategoryFormat | string;
    useStoreCategories?: boolean;
  }
): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const plan = resolveCategoryPlan(params);
  return parseCategoryAnswer(text, plan).value;
}
