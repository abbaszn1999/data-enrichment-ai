import type { JobKind } from "./types";
import { catalogIntelligencePath } from "@/lib/product-modules";

const KIND_LABEL: Record<JobKind, string> = {
  catalog: "Catalog Intelligence",
  gallery: "Products Gallery",
  visualizer: "Products Visualizer",
  mr_extract: "Market Research",
  fa_extract: "Free Assessment",
  mr_stage1: "Market Research",
  fa_stage1: "Free Assessment",
  mr_classify: "Market Research",
  fa_classify: "Free Assessment",
  mr_collections: "Market Research",
};

export function jobKindLabel(kind: JobKind): string {
  return KIND_LABEL[kind];
}

export function jobHref(params: {
  kind: JobKind;
  workspaceSlug: string;
  sessionId: string;
}): string {
  const slug = params.workspaceSlug.replace(/^\/+|\/+$/g, "");
  if (params.kind === "catalog") {
    return catalogIntelligencePath(slug, params.sessionId);
  }
  if (params.kind === "gallery") {
    return `/w/${slug}/products-gallery?project=${encodeURIComponent(params.sessionId)}`;
  }
  if (
    params.kind === "mr_extract" ||
    params.kind === "mr_stage1" ||
    params.kind === "mr_classify" ||
    params.kind === "mr_collections"
  ) {
    return `/w/${slug}/market-research`;
  }
  if (params.kind === "fa_extract" || params.kind === "fa_stage1" || params.kind === "fa_classify") {
    return `/w/${slug}/free-assessment`;
  }
  return `/w/${slug}/products-visualizer?project=${encodeURIComponent(params.sessionId)}`;
}
