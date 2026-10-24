/**
 * The Source URLs plan: up to 5 search requests ("steps") that the planner
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

/** The most searches one row gets, so also the most steps a plan can hold. */
export const SOURCE_URLS_PLAN_MAX_STEPS = 5;
const STEP_MIN_CHARS = 20;
const STEP_MAX_CHARS = 1_500;
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
 * Keeps the steps that are safe to send. A step must be a real request, use at
 * least one ticked column (a step with no placeholder would ask the same thing
 * for every row), and name only columns the owner ticked (a made-up column
 * could never be filled). Duplicates go; at most 5 stay.
 */
export function validatePlanSteps(raw: unknown, columnNames: string[]): ValidatedSteps {
  const known = new Set(columnNames.map(normalizeName));
  const steps: SourceUrlsPlanStep[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  list.forEach((item, index) => {
    const label = `step ${index + 1}`;
    if (!item || typeof item !== "object") return void dropped.push(`${label}: not an object`);
    const record = item as { name?: unknown; text?: unknown };
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (text.length < STEP_MIN_CHARS) return void dropped.push(`${label}: too short`);
    if (text.length > STEP_MAX_CHARS) return void dropped.push(`${label}: too long`);
    const used = placeholdersOf(text);
    if (used.length === 0) return void dropped.push(`${label}: uses no column`);
    const unknown = used.filter((name) => !known.has(normalizeName(name)));
    if (unknown.length > 0) return void dropped.push(`${label}: unknown column ${unknown.join(", ")}`);
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return void dropped.push(`${label}: repeats an earlier step`);
    seen.add(key);
    const name = (typeof record.name === "string" ? record.name.trim() : "").slice(0, STEP_NAME_MAX_CHARS);
    if (steps.length < SOURCE_URLS_PLAN_MAX_STEPS) steps.push({ name: name || `Step ${steps.length + 1}`, text });
    else dropped.push(`${label}: more than ${SOURCE_URLS_PLAN_MAX_STEPS} steps`);
  });
  return { steps, dropped };
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
  return {
    version: 1,
    source: record.source,
    steps,
    columns,
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
}

/**
 * The searches one row runs, in order, `maxTries` long. The steps the row can
 * use (every column it needs has a value) are tried in the plan's order. When
 * there are fewer of them than tries, they go round again from the first, so
 * every search is spent and the strongest step is also repeated: the answers
 * vary from one search to the next, so a repeat can find what the first
 * missed. A row that can use none of the steps gets the default query.
 */
export function expandTries(
  plan: SourceUrlsPlan | undefined,
  rowData: Record<string, string>,
  maxTries: number
): PlannedTry[] {
  const tries = Math.max(1, Math.floor(maxTries));
  const usable: PlannedTry[] = [];
  if (plan?.source === "planner") {
    for (const step of plan.steps) {
      const text = renderPlanStep(step, rowData);
      if (text !== null) usable.push({ label: step.name, text });
    }
  }
  if (usable.length === 0) return Array.from({ length: tries }, () => ({}));
  return Array.from({ length: tries }, (_, index) => usable[index % usable.length]!);
}
