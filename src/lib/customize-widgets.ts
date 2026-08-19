export type WidgetKind = "links" | "faq";
export type FontChoice = "default" | "sans" | "serif" | "rounded";
export type SizeChoice = "default" | "sm" | "md" | "lg";

export type WidgetStyle = {
  template: string;
  font: FontChoice;
  heading: string;
  headingColor: string;
  textColor: string;
  accentColor: string;
  backgroundColor: string;
  size: SizeChoice;
};

export type LinkTemplateId =
  | "pills"
  | "tiles"
  | "circles"
  | "rail"
  | "editorial";

export type FaqTemplateId =
  | "dividers"
  | "cards"
  | "split"
  | "accent"
  | "editorial";

export const LINK_TEMPLATES: {
  id: LinkTemplateId;
  name: string;
  blurb: string;
}[] = [
  {
    id: "pills",
    name: "Pills",
    blurb: "Compact chips — sits below the product grid as a next-step browse.",
  },
  {
    id: "tiles",
    name: "Image tiles",
    blurb: "Photo + name cards. The collection-menu pattern stores use most.",
  },
  {
    id: "circles",
    name: "Circles",
    blurb: "Round thumbnails with captions — story-style browse.",
  },
  {
    id: "rail",
    name: "Text rail",
    blurb: "Quiet text links. Strong for SEO, light on the page.",
  },
  {
    id: "editorial",
    name: "Editorial",
    blurb: "One featured card plus a list — magazine collection pages.",
  },
];

export const FAQ_TEMPLATES: {
  id: FaqTemplateId;
  name: string;
  blurb: string;
}[] = [
  {
    id: "dividers",
    name: "Dividers",
    blurb: "Classic accordion with hairline rules. Sits above the product grid.",
  },
  {
    id: "cards",
    name: "Cards",
    blurb: "Each question in its own rounded card.",
  },
  {
    id: "split",
    name: "Two columns",
    blurb: "Desktop split. Good when you have six or more answers.",
  },
  {
    id: "accent",
    name: "Accent bar",
    blurb: "Open item gets a brand-color edge — clear active state.",
  },
  {
    id: "editorial",
    name: "Editorial",
    blurb: "Large questions, airy answers. Brand and guide pages.",
  },
];

export const FONT_OPTIONS: { id: FontChoice; label: string; stack: string }[] = [
  {
    id: "default",
    label: "Default (Theme)",
    stack: "inherit",
  },
  {
    id: "sans",
    label: "Sans",
    stack: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  },
  {
    id: "serif",
    label: "Serif",
    stack: "ui-serif, Georgia, 'Times New Roman', serif",
  },
  {
    id: "rounded",
    label: "Rounded",
    stack: "ui-rounded, 'Nunito', 'Trebuchet MS', sans-serif",
  },
];

export const SIZE_SCALE: Record<
  SizeChoice,
  { heading: number; item: number; pad: number }
> = {
  default: { heading: 18, item: 14, pad: 14 },
  sm: { heading: 14, item: 12, pad: 10 },
  md: { heading: 18, item: 14, pad: 14 },
  lg: { heading: 22, item: 16, pad: 18 },
};

export const DEFAULT_LINKS_STYLE: WidgetStyle = {
  template: "pills",
  font: "default",
  heading: "Shop related",
  headingColor: "#111111",
  textColor: "#444444",
  accentColor: "#111111",
  backgroundColor: "#ffffff",
  size: "default",
};

export const DEFAULT_FAQ_STYLE: WidgetStyle = {
  template: "dividers",
  font: "default",
  heading: "Frequently asked questions",
  headingColor: "#111111",
  textColor: "#555555",
  accentColor: "#111111",
  backgroundColor: "#ffffff",
  size: "default",
};

export const SAMPLE_LINKS = [
  { id: "polarized", label: "Polarized Sunglasses", kind: "collection" },
  { id: "aviator", label: "Aviator Sunglasses", kind: "collection" },
  { id: "kids", label: "Kids Sunglasses", kind: "collection" },
  { id: "guide", label: "How to choose sunglasses", kind: "article" },
  { id: "vs", label: "Polarized vs non-polarized", kind: "article" },
] as const;

export const SAMPLE_FAQS = [
  {
    q: "What should I look for when buying polarized sunglasses?",
    a: "Start with fit and lens quality. Polarized lenses cut glare on water and roads. Filter by the attributes shoppers actually search for, then compare a shortlist.",
  },
  {
    q: "Do you sell sunglasses for kids and adults?",
    a: "Where the catalog supports it, both are included. Product counts on this page are live matches against your store — not marketing estimates.",
  },
  {
    q: "Are polarized sunglasses worth it?",
    a: "Yes if you drive, fish, or spend time outdoors. Polarization reduces reflected glare without changing the product range on this collection.",
  },
  {
    q: "How do I care for sunglasses?",
    a: "Follow the care notes on each product. Category FAQs stay high-level so they remain accurate across the whole collection.",
  },
] as const;

export const SAMPLE_COLLECTIONS = [
  { handle: "polarized-sunglasses", name: "Polarized Sunglasses" },
  { handle: "aviator-sunglasses", name: "Aviator Sunglasses" },
  { handle: "educational-toys", name: "Educational Toys" },
] as const;

export type PersistedWidgetSettings = {
  links: WidgetStyle;
  faq: WidgetStyle;
};

function storageKey(workspaceSlug: string) {
  return `customize-widgets:v1:${workspaceSlug}`;
}

export function loadCustomizeWidgets(workspaceSlug: string): PersistedWidgetSettings {
  const fallback: PersistedWidgetSettings = {
    links: { ...DEFAULT_LINKS_STYLE },
    faq: { ...DEFAULT_FAQ_STYLE },
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceSlug));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedWidgetSettings>;
    return {
      links: { ...DEFAULT_LINKS_STYLE, ...parsed.links },
      faq: { ...DEFAULT_FAQ_STYLE, ...parsed.faq },
    };
  } catch {
    return fallback;
  }
}

export function saveCustomizeWidgets(
  workspaceSlug: string,
  state: PersistedWidgetSettings
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(workspaceSlug), JSON.stringify(state));
  } catch {
    // ignore quota
  }
}

export function fontStack(font: FontChoice): string {
  if (font === "default") return "inherit";
  return FONT_OPTIONS.find((option) => option.id === font)?.stack ?? "inherit";
}

export function linksSnippet(handle = "{{ collection.handle }}", appUrl?: string): string {
  const base =
    (appUrl || "").replace(/\/+$/, "") || "https://data-enrichment-ai.onrender.com";
  return `<div data-dea="links" data-collection="${handle}"></div>\n<script async src="${base}/widget.js"></script>`;
}

export function faqSnippet(handle = "{{ collection.handle }}", appUrl?: string): string {
  const base =
    (appUrl || "").replace(/\/+$/, "") || "https://data-enrichment-ai.onrender.com";
  return `<div data-dea="faq" data-collection="${handle}"></div>\n<script async src="${base}/widget.js"></script>`;
}
