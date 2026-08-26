// Shared types for the Website Restructure (header builder) tool.
// Mirrors the market-research split between a lean Postgres row (`wr_projects`)
// and heavy slices kept in object storage.

export type WrPhase =
  | "collecting"
  | "awaiting_images"
  | "awaiting_logo"
  | "awaiting_competitors"
  | "building"
  | "editing"
  | "locked"
  | "failed";

export const WR_MAX_IMAGES = 10;
export const WR_MAX_COMPETITORS = 4;
export const WR_MAX_EDIT_MESSAGES = 10;

/** Lifetime project limit per subscription plan. This counts every project a
 *  workspace has ever created, not just currently-active ones, so deleting a
 *  project never frees up a new slot — see `wr_projects_created_total` on
 *  `workspaces` and the `wr_try_reserve_project_slot` RPC. */
export const WR_PLAN_PROJECT_LIMITS: Record<string, number> = {
  starter: 2,
  growth: 3,
  pro: 5,
};
export const WR_DEFAULT_PROJECT_LIMIT = 2;

export function getWrProjectLimit(planName: string | null | undefined): number {
  if (!planName) return WR_DEFAULT_PROJECT_LIMIT;
  return WR_PLAN_PROJECT_LIMITS[planName.toLowerCase()] ?? WR_DEFAULT_PROJECT_LIMIT;
}

/** A workspace may create at most `limit` projects over its lifetime. */
export function isAtWrProjectCap(createdTotal: number, limit: number): boolean {
  return createdTotal >= limit;
}

/** Client-driven wizard phase changes may only move forward through the
 *  data-collection steps — never backward, and never into a
 *  machine-controlled state like `building`/`editing`/`locked`/`failed`. */
const WR_CLIENT_PHASE_ORDER: WrPhase[] = [
  "collecting",
  "awaiting_images",
  "awaiting_logo",
  "awaiting_competitors",
];

export function canAdvanceWrPhase(current: WrPhase, next: WrPhase): boolean {
  const currentIdx = WR_CLIENT_PHASE_ORDER.indexOf(current);
  const nextIdx = WR_CLIENT_PHASE_ORDER.indexOf(next);
  return currentIdx !== -1 && nextIdx !== -1 && nextIdx >= currentIdx;
}

export type WrChatMessage = {
  id: string;
  role: "agent" | "user";
  text: string;
  /** Set on the message that reports a failed build/edit, for a subtle error style. */
  isError?: boolean;
};

export type WrUploadedImage = {
  id: string;
  storagePath: string;
  filename: string;
};

export type WrCompetitorInput = {
  /** Free text: a brand name, a URL, or both — the agent's web search resolves it. */
  raw: string;
};

/** Per-project mutable state kept inside `wr_projects.state` (jsonb). Chat
 *  stays here rather than in storage — small, and read on every page load. */
export type WrProjectState = {
  chat: WrChatMessage[];
  images: WrUploadedImage[];
  logo: WrUploadedImage | null;
  competitors: WrCompetitorInput[];
  /** True once the user explicitly said "no competitors" / "done". */
  competitorsSkipped?: boolean;
};

export const EMPTY_WR_STATE: WrProjectState = {
  chat: [],
  images: [],
  logo: null,
  competitors: [],
};

export type WrProjectRow = {
  id: string;
  workspaceId: string;
  name: string;
  status: "active" | "completed";
  provider: string;
  phase: WrPhase;
  editMessagesUsed: number;
  activeVersion: number;
  lastError: string | null;
  state: WrProjectState;
  createdAt: string;
  updatedAt: string;
};

/** Design facts extracted from the uploaded header screenshots + logo. */
export type WrDesignBrief = {
  colors: { primary: string; secondary: string; background: string; text: string };
  fontFamily: string;
  headerHeight: string;
  elements: string[];
  menuStyle: string;
  /** "ltr" | "rtl" — inferred from the store's language/screens. */
  textDirection: "ltr" | "rtl";
  notes: string;
};

export type WrCompetitorNote = {
  input: string;
  resolvedName: string;
  summary: string;
};

/** The agent's structured output for both the initial build and every edit. */
export type WrBuildResult = {
  html: string;
  css: string;
  js: string;
  notes: string;
};

export type WrVersion = {
  version: number;
  createdAt: string;
  notes: string;
  result: WrBuildResult;
  /** Present on edits: the free-text instruction that produced this version. */
  instruction?: string;
};

export type WrTaxonomyTreeNode = {
  id: string;
  title: string;
  productCount: number;
  url?: string;
  children: WrTaxonomyTreeNode[];
};

export type WrTaxonomyTree = {
  /** Real navigation menu, when the provider exposed one. */
  navigation: WrTaxonomyTreeNode[] | null;
  /** Top taxonomy groups by product count — always present, used when there
   *  is no navigation or to fill in groups navigation omitted. */
  topTaxonomies: WrTaxonomyTreeNode[];
  /** Count of taxonomy groups folded into "all categories" rather than named. */
  overflowCount: number;
  navigationUnavailableReason?: string;
};

export type WrStoreLinks = {
  provider: string;
  /** Absolute, e.g. "https://mystore.myshopify.com" — every URL below is
   *  built from this so links are correct both in-app (preview iframe is
   *  served from our own origin, not the store's) and in the final
   *  downloaded file embedded on the merchant's real site. */
  baseUrl: string;
  /** e.g. "https://mystore.myshopify.com/collections/{handle}" — `{handle}`
   *  is replaced by the caller, never guessed by the agent. */
  collectionUrlPattern: string;
  homeUrl: string;
  cartUrl: string;
  searchUrlPattern: string;
};
