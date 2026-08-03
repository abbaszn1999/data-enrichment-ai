import type { GalleryScrapingSettings } from "@/lib/gallery/types";

export type SerperImageCandidate = {
  imageUrl: string;
  pageUrl: string;
  title: string;
  width: number;
  height: number;
  sourceDomain: string;
};

const MARKETPLACE_DOMAINS = [
  "amazon.",
  "ebay.",
  "aliexpress.",
  "alibaba.",
  "walmart.",
  "etsy.",
  "wish.",
  "temu.",
  "rakuten.",
  "mercari.",
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function aspectBucket(ratio: number): string {
  if (ratio >= 1.6) return "landscape";
  if (ratio <= 0.75) return "portrait";
  return "square";
}

export function filterSerperCandidates(
  candidates: SerperImageCandidate[],
  settings: Pick<
    GalleryScrapingSettings,
    | "minResolution"
    | "aspectRatio"
    | "duplicates"
    | "sourcePolicy"
    | "excludeMarketplaces"
  >,
  officialDomainHints: string[] = []
): SerperImageCandidate[] {
  const seen = new Set<string>();
  const out: SerperImageCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.imageUrl) continue;
    if (settings.duplicates === "avoid" && seen.has(candidate.imageUrl)) continue;

    const w = candidate.width || 0;
    const h = candidate.height || 0;
    if (settings.minResolution > 0) {
      if (
        (w > 0 && w < settings.minResolution) ||
        (h > 0 && h < settings.minResolution)
      ) continue;
    }

    if (settings.aspectRatio && settings.aspectRatio !== "any" && w > 0 && h > 0) {
      const bucket = aspectBucket(w / h);
      if (settings.aspectRatio !== bucket) continue;
    }

    const domain = candidate.sourceDomain || hostnameOf(candidate.pageUrl || candidate.imageUrl);
    if (settings.excludeMarketplaces && MARKETPLACE_DOMAINS.some((d) => domain.includes(d))) {
      continue;
    }

    const official = officialDomainHints.some(
      (hint) => domain === hint || domain.endsWith(`.${hint}`)
    );
    if (settings.sourcePolicy === "official-only" && !official) {
      continue;
    }

    seen.add(candidate.imageUrl);
    out.push({ ...candidate, sourceDomain: domain });
  }

  if (settings.sourcePolicy === "prefer-official") {
    out.sort((a, b) => {
      const aOfficial = officialDomainHints.some(
        (hint) => a.sourceDomain === hint || a.sourceDomain.endsWith(`.${hint}`)
      );
      const bOfficial = officialDomainHints.some(
        (hint) => b.sourceDomain === hint || b.sourceDomain.endsWith(`.${hint}`)
      );
      return Number(bOfficial) - Number(aOfficial);
    });
  }

  return out;
}

export function buildGoogleQuery(
  rowData: Record<string, string>,
  selectedColumns: string[]
): string {
  const parts = selectedColumns
    .map((col) => (rowData[col] ?? "").toString().trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}
