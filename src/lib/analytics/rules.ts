import type {
  AnalyticsPageType,
  AnalyticsRuleConfig,
  AnalyticsRulePattern,
  Ga4FilterExpression,
} from "./types";

export const DEFAULT_ANALYTICS_RULE_CONFIG: AnalyticsRuleConfig = {
  filterMode: "include",
  patternType: "simple",
  patterns: {
    logic: "OR",
    rules: [{ value: "", enabled: true }],
  },
  isActive: true,
};

const MAX_PATTERNS = 20;
const MAX_PATTERN_LENGTH = 300;

export function analyticsPageCandidates(page: string): string[] {
  const trimmed = page.trim();
  if (!trimmed) return [];
  const candidates = [trimmed];
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const withSearch = `${url.pathname}${url.search}` || "/";
      candidates.push(withSearch);
      if (url.pathname && url.pathname !== withSearch) candidates.push(url.pathname);
    }
  } catch {
    // Keep the original string when it is not a valid URL.
  }
  return [...new Set(candidates)];
}

function enabledPatterns(config: AnalyticsRuleConfig): AnalyticsRulePattern[] {
  return config.patterns.rules.filter((rule) => rule.enabled !== false && rule.value.trim());
}

function patternMatches(candidate: string, pattern: string, type: AnalyticsRuleConfig["patternType"]): boolean {
  if (type === "regex") {
    try {
      return new RegExp(pattern, "i").test(candidate);
    } catch {
      return false;
    }
  }
  return candidate.toLowerCase().includes(pattern.toLowerCase());
}

export function pageMatchesRules(page: string, config: AnalyticsRuleConfig): boolean {
  if (!config.isActive) return true;
  const patterns = enabledPatterns(config);
  if (!patterns.length) return config.filterMode === "exclude";

  const candidates = analyticsPageCandidates(page);
  const tests = patterns.map((rule) =>
    candidates.some((candidate) => patternMatches(candidate, rule.value, config.patternType))
  );
  const matched = config.patterns.logic === "AND" ? tests.every(Boolean) : tests.some(Boolean);
  return config.filterMode === "exclude" ? !matched : matched;
}

export function filterPagesByRules<T extends { page?: string }>(
  rows: T[],
  config: AnalyticsRuleConfig
): T[] {
  return rows.filter((row) => pageMatchesRules(row.page || "", config));
}

export function validateAnalyticsRulePatterns(config: AnalyticsRuleConfig): string[] {
  const errors: string[] = [];
  const patterns = enabledPatterns(config);
  if (!patterns.length) errors.push("At least one pattern is required");
  if (config.patterns.rules.length > MAX_PATTERNS) {
    errors.push(`Use at most ${MAX_PATTERNS} patterns`);
  }
  if (config.patternType === "regex") {
    for (const rule of patterns) {
      try {
        new RegExp(rule.value);
      } catch {
        errors.push(`Invalid regex: "${rule.value}"`);
      }
    }
  }
  for (const rule of patterns) {
    if (rule.value.length > MAX_PATTERN_LENGTH) {
      errors.push(`Pattern is too long: "${rule.value.slice(0, 40)}…"`);
    }
  }
  return errors;
}

export function parseAnalyticsRuleConfig(input: unknown): {
  config: AnalyticsRuleConfig | null;
  errors: string[];
} {
  if (!input || typeof input !== "object") {
    return { config: null, errors: ["Missing rule configuration"] };
  }
  const body = input as Record<string, unknown>;
  const filterMode = body.filterMode;
  const patternType = body.patternType;
  const patterns = body.patterns;
  if (filterMode !== "include" && filterMode !== "exclude") {
    return { config: null, errors: ['filterMode must be "include" or "exclude"'] };
  }
  if (patternType !== "simple" && patternType !== "regex") {
    return { config: null, errors: ['patternType must be "simple" or "regex"'] };
  }
  if (!patterns || typeof patterns !== "object") {
    return { config: null, errors: ["patterns must have logic and rules"] };
  }
  const logic = (patterns as { logic?: unknown }).logic;
  const rules = (patterns as { rules?: unknown }).rules;
  if (logic !== "AND" && logic !== "OR") {
    return { config: null, errors: ['patterns.logic must be "AND" or "OR"'] };
  }
  if (!Array.isArray(rules)) {
    return { config: null, errors: ["patterns.rules must be an array"] };
  }

  const config: AnalyticsRuleConfig = {
    filterMode,
    patternType,
    isActive: body.isActive !== false,
    patterns: {
      logic,
      rules: rules
        .filter((rule): rule is Record<string, unknown> => !!rule && typeof rule === "object")
        .map((rule) => ({
          value: String(rule.value ?? "").trim(),
          enabled: rule.enabled !== false,
        }))
        .filter((rule) => rule.value),
    },
  };
  const errors = validateAnalyticsRulePatterns(config);
  return { config: errors.length ? null : config, errors };
}

export function buildGa4FilterExpression(config: AnalyticsRuleConfig): Ga4FilterExpression | undefined {
  if (!config.isActive) return undefined;
  const patterns = enabledPatterns(config);
  if (!patterns.length) return undefined;

  const matchType = config.patternType === "regex" ? "PARTIAL_REGEXP" : "CONTAINS";
  const toFilter = (value: string): Ga4FilterExpression => ({
    filter: {
      fieldName: "pagePath",
      stringFilter: {
        matchType,
        value,
        caseSensitive: false,
      },
    },
  });

  let expression: Ga4FilterExpression =
    patterns.length === 1
      ? toFilter(patterns[0].value)
      : config.patterns.logic === "AND"
        ? { andGroup: { expressions: patterns.map((rule) => toFilter(rule.value)) } }
        : { orGroup: { expressions: patterns.map((rule) => toFilter(rule.value)) } };

  if (config.filterMode === "exclude") {
    expression = { notExpression: expression };
  }
  return expression;
}

export function describeAnalyticsRules(config: AnalyticsRuleConfig): string {
  const mode = config.filterMode === "include" ? "Including" : "Excluding";
  const logic = config.patterns.logic;
  const patterns = enabledPatterns(config).map((rule) => `"${rule.value}"`);
  if (!patterns.length) return `${mode}: (no patterns)`;
  return `${mode}: ${patterns.join(` ${logic} `)}`;
}

export function analyticsPageTypeLabel(pageType: AnalyticsPageType): string {
  return pageType === "plp" ? "PLP" : "Products";
}
