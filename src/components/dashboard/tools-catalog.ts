import {
  Package,
  FolderTree,
  Upload,
  Image as ImageIcon,
  LayoutGrid,
  Boxes,
  Search,
  Paintbrush,
  RefreshCw,
  Wallet,
  LayoutTemplate,
  Bot,
  CreditCard,
  Users,
  Settings,
  Crown,
  type LucideIcon,
} from "lucide-react";

/** How a tool is paid for. Drives the badge shown on its card. */
export type ToolBilling = "credits" | "wallet" | "free";

export type ToolCategory = "agents" | "visual" | "growth" | "data" | "account";

export interface ToolDefinition {
  /** Path segment appended to /w/[slug] — empty string means the workspace root. */
  path: string;
  name: string;
  /** One line, merchant-facing: what this does for them. */
  blurb: string;
  icon: LucideIcon;
  category: ToolCategory;
  /** The AI model behind it, when there is one. Shown as a small mono badge. */
  model?: string;
  billing: ToolBilling;
  /** True when the tool cannot run without a connected store. */
  needsIntegration?: boolean;
  /** Only visible to admins/owners ("admin") or owners ("owner"). */
  requiresRole?: "admin" | "owner";
  /** Extra keywords so search finds the tool by what it does, not just its name. */
  keywords?: string[];
}

export const TOOL_CATEGORIES: {
  id: ToolCategory | "all";
  label: string;
}[] = [
  { id: "all", label: "Everything" },
  { id: "agents", label: "AI agents" },
  { id: "visual", label: "Visual AI" },
  { id: "growth", label: "Growth" },
  { id: "data", label: "Catalog" },
  { id: "account", label: "Workspace" },
];

/** Per-category accent, kept as literal class strings so Tailwind keeps them. */
export const CATEGORY_STYLE: Record<
  ToolCategory,
  { text: string; bg: string; ring: string; glow: string; dot: string }
> = {
  agents: {
    text: "text-violet-500",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/20",
    glow: "rgba(139,92,246,0.16)",
    dot: "bg-violet-500",
  },
  visual: {
    text: "text-sky-500",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/20",
    glow: "rgba(14,165,233,0.16)",
    dot: "bg-sky-500",
  },
  growth: {
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/20",
    glow: "rgba(16,185,129,0.16)",
    dot: "bg-emerald-500",
  },
  data: {
    text: "text-amber-500",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/20",
    glow: "rgba(245,158,11,0.16)",
    dot: "bg-amber-500",
  },
  account: {
    text: "text-slate-500",
    bg: "bg-slate-500/10",
    ring: "ring-slate-500/20",
    glow: "rgba(100,116,139,0.14)",
    dot: "bg-slate-500",
  },
};

export const BILLING_LABEL: Record<ToolBilling, string> = {
  credits: "AI credits",
  wallet: "Wallet",
  free: "Included",
};

/** Every tool in the workspace, in the order they should be showcased. */
export const TOOLS: ToolDefinition[] = [
  // ── AI agents (the headline features) ──
  {
    path: "/sync",
    name: "Store assistant",
    blurb:
      "Chat with an agent that can read and rewrite products and categories straight in your store.",
    icon: Bot,
    category: "agents",
    model: "gemini-3.6-flash · gpt-5.6-sol",
    billing: "wallet",
    needsIntegration: true,
    keywords: ["chat", "copilot", "assistant", "agent", "edit products"],
  },
  {
    path: "/market-research",
    name: "Market research",
    blurb:
      "A seven-stage SEO agent: finds niches and keywords, then writes collections and articles into your store.",
    icon: Search,
    category: "agents",
    model: "gemini-3.7-flash",
    billing: "wallet",
    needsIntegration: true,
    keywords: ["seo", "keywords", "collections", "articles", "content", "niche"],
  },
  {
    path: "/website-restructure",
    name: "Website restructure",
    blurb:
      "Rebuilds your storefront header and navigation through chat, with a live preview and version history.",
    icon: LayoutTemplate,
    category: "agents",
    model: "gemini-3.7-flash",
    billing: "free",
    needsIntegration: true,
    keywords: ["header", "navigation", "menu", "design", "preview"],
  },
  {
    path: "/growth-sync",
    name: "Sync",
    blurb:
      "Set a rule once and new store products get classified into the right categories automatically, every 24 hours.",
    icon: RefreshCw,
    category: "agents",
    model: "gemini-3.7-flash",
    billing: "wallet",
    needsIntegration: true,
    keywords: ["automation", "rules", "classify", "schedule", "background"],
  },

  // ── Visual AI ──
  {
    path: "/products-gallery",
    name: "Products Gallery",
    blurb:
      "Generates clean product photography for every row in your catalog, then exports the whole gallery.",
    icon: LayoutGrid,
    category: "visual",
    model: "gemini-3-pro-image",
    billing: "credits",
    keywords: ["images", "photos", "photography", "generate", "gallery"],
  },
  {
    path: "/products-visualizer",
    name: "Products Visualizer",
    blurb:
      "Writes rich product descriptions and pairs them with staged lifestyle imagery you can lay out yourself.",
    icon: Boxes,
    category: "visual",
    model: "gpt-5.6-sol + gemini image",
    billing: "credits",
    keywords: ["descriptions", "lifestyle", "copy", "visuals", "render"],
  },
  {
    path: "/image-classify",
    name: "Image Classification",
    blurb:
      "Drop in a folder of product images and have them matched to the right SKU or category.",
    icon: ImageIcon,
    category: "visual",
    model: "gemini-3.6-flash",
    billing: "credits",
    keywords: ["classify", "sku", "match", "vision", "sort images"],
  },

  // ── Catalog / data ──
  {
    path: "/import",
    name: "Catalog Intelligence",
    blurb:
      "Upload a messy spreadsheet and let a web-searching agent map the columns and fill the gaps.",
    icon: Upload,
    category: "data",
    model: "gpt-5.6-terra · web search",
    billing: "credits",
    keywords: ["import", "excel", "csv", "spreadsheet", "enrich", "mapping"],
  },
  {
    path: "/products",
    name: "Products",
    blurb: "Your master catalog — search, review and clean up every product you own.",
    icon: Package,
    category: "data",
    billing: "free",
    keywords: ["catalog", "table", "list", "skus"],
  },
  {
    path: "/categories",
    name: "Categories",
    blurb: "Build and reorder the category tree that every agent classifies against.",
    icon: FolderTree,
    category: "data",
    billing: "free",
    keywords: ["taxonomy", "tree", "structure", "collections"],
  },

  // ── Growth extras ──
  {
    path: "/customize",
    name: "Customize",
    blurb:
      "Style the FAQ and related-link blocks you embed on your storefront, and set your AI naming prefix.",
    icon: Paintbrush,
    category: "growth",
    billing: "free",
    needsIntegration: true,
    keywords: ["widgets", "embed", "faq", "blocks", "branding", "prefix"],
  },
  {
    path: "/wallet",
    name: "Wallet",
    blurb: "Prepaid balance for the wallet-billed agents, with a full transaction ledger.",
    icon: Wallet,
    category: "growth",
    billing: "free",
    keywords: ["balance", "top up", "money", "billing", "ledger", "stripe"],
  },
  {
    path: "/usage",
    name: "Usage",
    blurb: "Every AI credit you have spent, broken down by operation and by team member.",
    icon: CreditCard,
    category: "growth",
    billing: "free",
    keywords: ["credits", "spend", "history", "analytics", "report"],
  },

  // ── Workspace / account ──
  {
    path: "/settings",
    name: "Settings",
    blurb:
      "Connect your store and manage workspace basics — this is what unlocks the store-aware agents.",
    icon: Settings,
    category: "account",
    billing: "free",
    requiresRole: "admin",
    keywords: ["integration", "shopify", "woocommerce", "connect", "store"],
  },
  {
    path: "/team",
    name: "Team",
    blurb: "Invite teammates and decide who can view, edit or administer this workspace.",
    icon: Users,
    category: "account",
    billing: "free",
    requiresRole: "admin",
    keywords: ["members", "invite", "roles", "permissions"],
  },
  {
    path: "/subscription",
    name: "Subscription",
    blurb: "Change your plan or buy extra AI credits at any amount you like.",
    icon: Crown,
    category: "account",
    billing: "free",
    requiresRole: "owner",
    keywords: ["plan", "billing", "upgrade", "credits", "buy"],
  },
];

/** Filters the catalog down to what this user is actually allowed to open. */
export function visibleTools(opts: {
  canAdmin: boolean;
  isOwner: boolean;
}): ToolDefinition[] {
  return TOOLS.filter((tool) => {
    if (tool.requiresRole === "owner") return opts.isOwner;
    if (tool.requiresRole === "admin") return opts.canAdmin;
    return true;
  });
}

/** Loose text match across name, blurb and keywords. */
export function matchesQuery(tool: ToolDefinition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [tool.name, tool.blurb, tool.model ?? "", ...(tool.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
