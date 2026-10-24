/**
 * The Source URLs plan: exactly 3 search requests ("steps"), strongest first, that the planner
 * (./planner.ts) wrote ONCE for a whole run from the owner's custom
 * instruction, the ticked columns and a few sample values. A step is plain
 * text with `{{Column name}}` placeholders. For each row the code fills the
 * placeholders with that row's own values, so the planner never sees, writes
 * or can get wrong a product value.
 *
 * This file is pure (no network, no AI): placeholder reading, validation of
 * what the planner returned, filling a step for one row, and the order the
 * steps are tried in. The plan is stored with the job, so every row (each may
 * run in its own process) follows the same plan, and a resumed run does not
 * plan again.
 */
import { productFields } from "./skill";

/** A plan holds three requests: the first is asked three times at once, the other two together if that finds nothing. */
export const SOURCE_URLS_PLAN_MAX_STEPS = 3;
/**
 * The longest a request may be. The whole search (request, identity, fixed
 * rule) stays far below SearchApi's 8,000 characters, and short requests keep
 * Google AI Mode from turning strict or slow. A longer request is cut, never dropped.
 */
export const SOURCE_URLS_STEP_MAX_CHARS = 600;
const STEP_NAME_MAX_CHARS = 60;
/** One filled-in value; keeps a long description from crowding out the request. */
const VALUE_MAX_CHARS = 400;

const PLACEHOLDER = /\{\{\s*([^{}]{1,80}?)\s*\}\}/g;

export interface SourceUrlsPlanStep {
  /** A short label for logs and the "not found" note, e.g. "Barcode first". */
  name: string;
  /** The request, with `{{Column name}}` placeholders. */
  text: string;
}

/** What planning cost, kept with the plan so the charge can be (re)made exactly once. */
export interface SourceUrlsPlanBilling {
  credits: number;
  cost: number;
  tokens: number;
  billedAttempts: number;
  details?: Record<string, unknown>;
  /** The charge was taken (in full, or the balance's remainder); never taken again. */
  settled?: boolean;
}

export interface SourceUrlsPlan {
  version: 1;
  /** "planner": the steps were written for this run. "default": today's one query is used for every try. */
  source: "planner" | "default";
  steps: SourceUrlsPlanStep[];
  /** The ticked columns the planner saw (the names a placeholder may use). */
  columns: string[];
  /**
   * The ticked columns that say WHAT the product is (name, brand, a short
   * description), chosen by the planner. The code adds them, with the row's
   * values, to every planned search as the product's identity. Absent: all
   * ticked columns are used instead.
   */
  identityColumns?: string[];
  model?: string;
  /** One line from the planner on what it set up. */
  notes?: string;
  /** Why the default query is used, when planning was needed but did not produce steps. */
  reason?: string;
  billing?: SourceUrlsPlanBilling;
}

export function defaultSourceUrlsPlan(reason?: string): SourceUrlsPlan {
  return { version: 1, source: "default", steps: [], columns: [], ...(reason ? { reason } : {}) };
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The column names a text uses in `{{ }}`, trimmed, each once, in order of appearance. */
export function placeholdersOf(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = (match[1] ?? "").trim().replace(/\s+/g, " ");
    if (name && !found.some((known) => normalizeName(known) === normalizeName(name))) found.push(name);
  }
  return found;
}

export interface ValidatedSteps {
  steps: SourceUrlsPlanStep[];
  /** Why each rejected step was dropped, for the log. */
  dropped: string[];
}

/**
 * A request cut to its limit: at the last line or word break, and never
 * through the middle of a `{{ }}` placeholder (half of one would be sent as
 * literal text).
 */
export function cutStepText(text: string, maxChars: number = SOURCE_URLS_STEP_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  let cut = text.slice(0, maxChars);
  const open = cut.lastIndexOf("{{");
  if (open > cut.lastIndexOf("}}")) cut = cut.slice(0, open);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  if (lastBreak > maxChars * 0.7) cut = cut.slice(0, lastBreak);
  return cut.trimEnd();
}

/**
 * The planner's requests, as they will be sent. Nothing is removed for being
 * short, long, repeated or free of placeholders: a long one is cut
 * (cutStepText), and the first three are kept. Only what can never work is
 * left out: something that is not a request at all (no text), and a request
 * naming a column the owner did not tick, whose placeholder could never be
 * filled. The caller asks the planner again when fewer than three remain.
 */
export function validatePlanSteps(raw: unknown, columnNames: string[]): ValidatedSteps {
  const known = new Set(columnNames.map(normalizeName));
  const steps: SourceUrlsPlanStep[] = [];
  const dropped: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  list.forEach((item, index) => {
    const label = `step ${index + 1}`;
    if (!item || typeof item !== "object") return void dropped.push(`${label}: not an object`);
    const record = item as { name?: unknown; text?: unknown };
    const text = cutStepText(typeof record.text === "string" ? record.text.trim() : "");
    if (!text) return void dropped.push(`${label}: empty`);
    const unknown = placeholdersOf(text).filter((name) => !known.has(normalizeName(name)));
    if (unknown.length > 0) return void dropped.push(`${label}: unknown column ${unknown.join(", ")}`);
    const name = (typeof record.name === "string" ? record.name.trim() : "").slice(0, STEP_NAME_MAX_CHARS);
    if (steps.length < SOURCE_URLS_PLAN_MAX_STEPS) steps.push({ name: name || `Step ${steps.length + 1}`, text });
    else dropped.push(`${label}: more than ${SOURCE_URLS_PLAN_MAX_STEPS} steps`);
  });
  return { steps, dropped };
}
/** The most identity columns a plan keeps, and the longest value one identity line shows. */
export const SOURCE_URLS_IDENTITY_MAX_COLUMNS = 6;
export const SOURCE_URLS_IDENTITY_VALUE_CHARS = 200;

/**
 * The planner's identity columns, kept only if they are ticked columns (any
 * letter case; the ticked spelling is kept), each once, at most six. Anything
 * else is dropped; an empty result means "use every ticked column".
 */
export function validateIdentityColumns(raw: unknown, columnNames: string[]): string[] {
  const byKey = new Map(columnNames.map((name) => [normalizeName(name), name]));
  const kept: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== "string") continue;
    const name = byKey.get(normalizeName(item));
    if (name && !kept.includes(name)) kept.push(name);
    if (kept.length >= SOURCE_URLS_IDENTITY_MAX_COLUMNS) break;
  }
  return kept;
}

/**
 * The product's identity for one row, one "Name: value" line per column: the
 * plan's identity columns, or (none chosen) every ticked column that has a
 * value. A column with no value on this row is left out; it never skips a
 * search. Each value is cut so a long description cannot crowd out the request.
 */
export function renderIdentityLines(plan: SourceUrlsPlan, rowData: Record<string, string>): string[] {
  const fields = productFields(rowData);
  const byKey = new Map(fields.map((field) => [normalizeName(field.name), field]));
  const wanted = plan.identityColumns?.length ? plan.identityColumns : fields.map((field) => field.name);
  const lines: string[] = [];
  for (const name of wanted) {
    const field = byKey.get(normalizeName(name));
    if (field?.value) lines.push(`${field.name}: ${field.value.slice(0, SOURCE_URLS_IDENTITY_VALUE_CHARS)}`);
  }
  return lines;
}

/**
 * A plan read back from the job's saved settings (which anyone could have
 * hand-edited): anything that is not a well-formed plan is ignored, so a bad
 * value can only mean "use the default query", never a crash.
 */
export function readStoredPlan(value: unknown): SourceUrlsPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<SourceUrlsPlan>;
  if (record.version !== 1) return undefined;
  if (record.source !== "planner" && record.source !== "default") return undefined;
  const columns = Array.isArray(record.columns) ? record.columns.filter((c): c is string => typeof c === "string") : [];
  const steps =
    record.source === "planner" ? validatePlanSteps(record.steps, columns).steps : [];
  if (record.source === "planner" && steps.length === 0) return undefined;
  const billing = record.billing && typeof record.billing === "object" ? record.billing : undefined;
  const identityColumns = validateIdentityColumns(record.identityColumns, columns);
  return {
    version: 1,
    source: record.source,
    steps,
    columns,
    ...(identityColumns.length > 0 ? { identityColumns } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.notes === "string" ? { notes: record.notes } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    ...(billing ? { billing } : {}),
  };
}

/**
 * One step filled in for one row. Returns null when a column the step needs
 * has no value on this row: that step is skipped for the row rather than
 * searching for a blank.
 */
export function renderPlanStep(step: SourceUrlsPlanStep, rowData: Record<string, string>): string | null {
  const values = new Map<string, string>();
  for (const field of productFields(rowData)) values.set(normalizeName(field.name), field.value);
  let missing = false;
  const text = step.text.replace(PLACEHOLDER, (_whole, rawName: string) => {
    const value = values.get(normalizeName(rawName));
    if (!value) {
      missing = true;
      return "";
    }
    return value.slice(0, VALUE_MAX_CHARS);
  });
  return missing ? null : text;
}

export interface PlannedTry {
  /** The step's name; absent for the default query. */
  label?: string;
  /** The request filled in for this row; absent for the default query. */
  text?: string;
  /** The product's identity lines for this row, added to the request; absent for the default query. */
  identity?: string[];
}

/** Searches in the first round: the strongest request, asked this many times at once. */
export const SOURCE_URLS_FIRST_ROUND_SEARCHES = 3;

export interface PlannedRounds {
  /** The strongest request, repeated, all sent at once. */
  first: PlannedTry[];
  /** Sent together, only when the first round found nothing. */
  second: PlannedTry[];
}

/**
 * The searches one row runs, `maxTries` in all (five). The steps the row can
 * use (every column it needs has a value) keep the plan's order.
 *
 * - First round: the first usable step, three times at once. Google AI Mode
 *   answers the same question differently each time, so the combined answers
 *   hold more pages than one.
 * - Second round, only if the first found nothing: the other usable steps
 *   together. With fewer than two of them, the last one is repeated so every
 *   search is spent; with only one usable step, it is the one repeated.
 *
 * A row that can use none of the steps (or has no plan) gets the default
 * query in both rounds.
 */
export function planRounds(
  plan: SourceUrlsPlan | undefined,
  rowData: Record<string, string>,
  maxTries: number
): PlannedRounds {
  const total = Math.max(1, Math.floor(maxTries));
  const firstCount = Math.min(SOURCE_URLS_FIRST_ROUND_SEARCHES, total);
  const secondCount = total - firstCount;

  const usable: PlannedTry[] = [];
  if (plan?.source === "planner") {
    const identity = renderIdentityLines(plan, rowData);
    for (const step of plan.steps) {
      const text = renderPlanStep(step, rowData);
      if (text !== null) usable.push({ label: step.name, text, identity });
    }
  }
  if (usable.length === 0) usable.push({});

  const others = usable.length > 1 ? usable.slice(1) : [usable[0]!];
  return {
    first: Array.from({ length: firstCount }, () => usable[0]!),
    second: Array.from({ length: secondCount }, (_, index) => others[index % others.length]!),
  };
}