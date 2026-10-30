// Agent documents: plans, reports, audits and other deliverables the agent
// writes into tabs beside the chat. Built from typed blocks so numbers can be
// live, sections can be edited one at a time, and every edit is a version.

import { gid } from "./mutations";
import type { MetricKey, MutateOp } from "./types";

export type DocType = "PLAN" | "REPORT" | "AUDIT" | "BUDGET" | "KEYWORDS" | "ADCOPY" | "FEED" | "EXPERIMENT" | "COMPETITORS";

export const DOC_TYPES: Record<DocType, { label: string; emoji: string; blurb: string; prompt: string }> = {
  PLAN: { label: "Campaign plan", emoji: "📋", blurb: "Goal, budget split, structure, messaging, timeline and steps", prompt: "Make me a Ramadan campaign plan" },
  REPORT: { label: "Performance report", emoji: "📈", blurb: "Key numbers, trends, winners and losers, recommendations", prompt: "Write my monthly performance report" },
  AUDIT: { label: "Account audit", emoji: "🔍", blurb: "Health score, issues by impact and the fix for each", prompt: "Write a full audit report of my account" },
  BUDGET: { label: "Budget plan", emoji: "💰", blurb: "How to split a budget across campaigns, with forecasts", prompt: "Plan how to spend $12,000 next month" },
  KEYWORDS: { label: "Keyword research", emoji: "🔑", blurb: "Keyword groups, volumes, costs and a structure", prompt: "Research keywords for trail running shoes" },
  ADCOPY: { label: "Ad copy", emoji: "✍️", blurb: "Headlines and descriptions by audience, ready to test", prompt: "Write ad copy for our leggings" },
  FEED: { label: "Product feed review", emoji: "🛍️", blurb: "Products with issues, why, and catalog fixes", prompt: "Review my product feed" },
  EXPERIMENT: { label: "Experiment plan", emoji: "🧪", blurb: "Hypothesis, split, duration and success criteria", prompt: "Plan an experiment for Target ROAS on Shopping" },
  COMPETITORS: { label: "Competitor analysis", emoji: "🏁", blurb: "Who you compete with, their messages, your openings", prompt: "Analyse my competitors" },
};

export type ValueFormat = "money" | "number" | "percent" | "ratio" | "text";

export type ChecklistItem = {
  id: string;
  text: string;
  detail?: string;
  /** Changes this step makes; running it creates a pending change. */
  ops?: MutateOp[];
  risk?: "LOW" | "MEDIUM" | "HIGH";
  /** Pending change created from this step. */
  changeId?: string;
  done?: boolean;
};

export type DocBlock =
  | { kind: "text"; md: string }
  | { kind: "callout"; tone: "info" | "good" | "warn" | "bad"; title: string; text: string }
  | {
      kind: "kpis";
      items: {
        label: string;
        value?: string;
        /** Live: computed from the account at render time. */
        metric?: MetricKey;
        campaignIds?: string[];
        delta?: number;
        hint?: string;
      }[];
    }
  | {
      kind: "chart";
      title: string;
      variant: "line" | "bar" | "donut";
      format: ValueFormat;
      data?: { label: string; value: number; value2?: number }[];
      seriesNames?: [string, string?];
      /** Live daily series from the account. */
      live?: { metric: MetricKey; metric2?: MetricKey; campaignIds?: string[] };
    }
  | { kind: "table"; columns: string[]; rows: (string | number)[][]; align?: ("left" | "right")[]; highlightLast?: boolean }
  | { kind: "tree"; items: { name: string; meta: string; children: { name: string; meta?: string; chips?: string[] }[] }[] }
  | { kind: "ads"; items: { audience?: string; headlines: string[]; description: string; url: string }[] }
  | { kind: "timeline"; phases: { label: string; when: string; focus: string; items: string[]; budgetShare?: number }[] }
  | { kind: "score"; score: number; label: string; parts: { label: string; score: number }[] }
  | { kind: "checklist"; items: ChecklistItem[] };

export type DocSection = { id: string; title: string; blocks: DocBlock[] };

export type DocVersion = { version: number; at: string; author: "AGENT" | "YOU"; note: string; sections: DocSection[]; changedSectionIds: string[] };

export type DocComment = {
  id: string;
  sectionId: string;
  author: "YOU" | "AGENT";
  text: string;
  at: string;
  resolved?: boolean;
  /** Agent replies thread under the comment. */
  replies: { author: "YOU" | "AGENT"; text: string; at: string }[];
};

export type AgentDoc = {
  id: string;
  type: DocType;
  title: string;
  subtitle?: string;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  version: number;
  sections: DocSection[];
  versions: DocVersion[];
  /** Sections the last version changed, highlighted until viewed. */
  changedSectionIds: string[];
  comments: DocComment[];
  /** Specialists who worked on it. */
  team: string[];
  schedule?: { frequency: "WEEKLY" | "MONTHLY"; recipients: string[]; nextRun: string };
  shareUrl?: string;
  /** Inputs the generator used, so edits can regenerate. */
  inputs?: Record<string, string | number>;
};

export function section(title: string, ...blocks: DocBlock[]): DocSection {
  return { id: gid("sec"), title, blocks };
}

export function newDoc(type: DocType, title: string, sections: DocSection[], extra: Partial<AgentDoc> = {}): AgentDoc {
  const now = new Date().toISOString();
  return {
    id: gid("doc"),
    type,
    title,
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    version: 1,
    sections,
    versions: [{ version: 1, at: now, author: "AGENT", note: "First draft", sections, changedSectionIds: [] }],
    changedSectionIds: [],
    comments: [],
    team: [],
    ...extra,
  };
}

/** Sections whose content differs between two versions (matched by title). */
export function changedSections(before: DocSection[], after: DocSection[]): string[] {
  const prev = new Map(before.map((s) => [s.title, JSON.stringify(s.blocks)]));
  return after.filter((s) => prev.get(s.title) !== JSON.stringify(s.blocks)).map((s) => s.id);
}

export function reviseDoc(doc: AgentDoc, sections: DocSection[], note: string, author: "AGENT" | "YOU" = "AGENT", extra: Partial<AgentDoc> = {}): AgentDoc {
  const version = doc.version + 1;
  const at = new Date().toISOString();
  const changed = changedSections(doc.sections, sections);
  return {
    ...doc,
    ...extra,
    sections,
    version,
    updatedAt: at,
    changedSectionIds: changed,
    versions: [...doc.versions, { version, at, author, note, sections, changedSectionIds: changed }],
  };
}

export function docToMarkdown(doc: AgentDoc): string {
  const out: string[] = [`# ${doc.title}`, doc.subtitle ?? "", ""];
  for (const s of doc.sections) {
    out.push(`## ${s.title}`, "");
    for (const b of s.blocks) {
      if (b.kind === "text") out.push(b.md, "");
      if (b.kind === "callout") out.push(`> **${b.title}** ${b.text}`, "");
      if (b.kind === "table") out.push(`| ${b.columns.join(" | ")} |`, `| ${b.columns.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.join(" | ")} |`), "");
      if (b.kind === "checklist") out.push(...b.items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}`), "");
      if (b.kind === "timeline") out.push(...b.phases.map((p) => `- **${p.label}** (${p.when}): ${p.focus}`), "");
    }
  }
  return out.join("\n");
}

// ─── Business profile & memory ─────────────────────────────────────────────

export type Competitor = { name: string; url: string };

export type PaletteColor = { name: string; hex: string; role: string };

/** Brand identity the agent follows when it writes ads, picks images and builds documents. */
export type BrandGuidelines = {
  /** Who the brand is: positioning, personality, what it stands for. */
  identity: string;
  logoUrl: string;
  /** Photography and layout direction for every visual asset. */
  visualDirection: string;
  palette: PaletteColor[];
};

/**
 * The business knowledge base. The agent fills it during onboarding and keeps
 * it current; the dashboard only shows it. Every plan, report and
 * recommendation reads from here, so advice fits the margins and the brand.
 */
export type BusinessProfile = {
  businessName: string;
  website: string;
  /** Markets the business sells to. */
  markets: string[];
  /** Product categories the website sells. */
  categories: string[];
  /** Gross margin, 0–1. Break-even ROAS = 1 / margin. */
  margin: number;
  averageOrderValue: number;
  targetRoas: number;
  monthlyBudgetCap: number;
  keySellingPoints: string[];
  competitiveAdvantages: string[];
  competitors: Competitor[];
  peakSeasons: string[];
  neverAdvertise: string[];
  brandVoice: string;
  brand: BrandGuidelines;
  /** When the agent last updated the profile (ISO). */
  updatedAt?: string;
};

export type AgentMemory = {
  id: string;
  text: string;
  source: "YOU" | "AGENT";
  at: string;
};

const STRIDE_LOGO = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#400095"/><path d="M17 41 L29 23 L36 33 L47 18" stroke="#F76D01" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}`;

export const DEFAULT_PROFILE: BusinessProfile = {
  businessName: "Stride Sportswear",
  website: "https://stride-store.com",
  markets: ["Saudi Arabia", "United Arab Emirates"],
  categories: ["Running shoes", "Gym wear", "Sports accessories", "Kids sportswear"],
  margin: 0.42,
  averageOrderValue: 104,
  targetRoas: 4,
  monthlyBudgetCap: 18000,
  keySellingPoints: ["Heat-tested comfort for Gulf summers", "Free delivery in 2 days across KSA and UAE", "30-day free returns", "Own-brand shoes at mid-market prices"],
  competitiveAdvantages: ["Only brand designing shoes for 40°C+ running", "Same-day delivery in Riyadh, Jeddah and Dubai", "Arabic-first support, 7 days a week"],
  competitors: [
    { name: "Nike", url: "https://www.nike.com" },
    { name: "Adidas", url: "https://www.adidas.com" },
    { name: "Namshi", url: "https://www.namshi.com" },
    { name: "Noon", url: "https://www.noon.com" },
  ],
  peakSeasons: ["Ramadan & Eid", "White Friday (November)", "Back to school (August)"],
  neverAdvertise: ["Clearance items under $20", "Discontinued sizes", "Competitor brand names in ad copy"],
  brandVoice: "Confident, energetic and practical. Mention heat-tested comfort and fast delivery. No discounts in headlines unless there is a sale.",
  brand: {
    identity: "A Gulf-born sportswear brand for people who train in the heat. Practical and energetic, never showy: performance first, then style.",
    logoUrl: STRIDE_LOGO,
    visualDirection: "Real athletes outdoors at sunrise and sunset, warm natural light, motion and sweat over studio polish. Product on a clean background for shopping images. One bold colour accent per image.",
    palette: [
      { name: "Stride Violet", hex: "#400095", role: "Primary" },
      { name: "Sunset Orange", hex: "#F76D01", role: "Accent" },
      { name: "Heat Red", hex: "#C40000", role: "Sale and urgency" },
      { name: "Sand", hex: "#F6F4FA", role: "Backgrounds" },
      { name: "Ink", hex: "#16121C", role: "Text" },
    ],
  },
  updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
};

/** A profile the agent has not filled yet (before onboarding). */
export function emptyProfile(businessName = ""): BusinessProfile {
  return {
    businessName,
    website: "",
    markets: [],
    categories: [],
    margin: 0,
    averageOrderValue: 0,
    targetRoas: 0,
    monthlyBudgetCap: 0,
    keySellingPoints: [],
    competitiveAdvantages: [],
    competitors: [],
    peakSeasons: [],
    neverAdvertise: [],
    brandVoice: "",
    brand: { identity: "", logoUrl: "", visualDirection: "", palette: [] },
  };
}

/** The sections of the profile page, and what makes each one "filled". */
export const PROFILE_SECTIONS: { id: string; label: string; filled: (p: BusinessProfile) => boolean }[] = [
  { id: "business", label: "Business", filled: (p) => !!p.businessName && !!p.website },
  { id: "markets", label: "Markets & catalog", filled: (p) => p.markets.length > 0 && p.categories.length > 0 },
  { id: "economics", label: "Economics", filled: (p) => p.margin > 0 && p.averageOrderValue > 0 && p.targetRoas > 0 && p.monthlyBudgetCap > 0 },
  { id: "positioning", label: "Positioning", filled: (p) => p.keySellingPoints.length > 0 && p.competitiveAdvantages.length > 0 && p.competitors.length > 0 },
  { id: "guardrails", label: "Guardrails", filled: (p) => p.peakSeasons.length > 0 && p.neverAdvertise.length > 0 },
  { id: "brand", label: "Brand guidelines", filled: (p) => !!p.brand.identity && !!p.brand.logoUrl && !!p.brand.visualDirection && p.brand.palette.length > 0 && !!p.brandVoice },
];

export function profileCompleteness(p: BusinessProfile) {
  const sections = PROFILE_SECTIONS.map((s) => ({ id: s.id, label: s.label, filled: s.filled(p) }));
  return { sections, done: sections.filter((s) => s.filled).length, total: sections.length };
}

export function seedMemories(): AgentMemory[] {
  const at = new Date(Date.now() - 6 * 86400000).toISOString();
  return [
    { id: gid("mem"), text: "Broad match on Running Shoes was tested in August: +3% conversions but +11% CPA. Owner prefers phrase match.", source: "AGENT", at },
    { id: gid("mem"), text: "Never let total daily spend go above $600 without asking.", source: "YOU", at },
    { id: gid("mem"), text: "Glide 3 is the hero product for 2026; keep it in every running campaign.", source: "YOU", at },
  ];
}
