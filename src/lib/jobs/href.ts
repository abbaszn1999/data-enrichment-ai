import type { JobKind } from "./types";

const KIND_LABEL: Record<JobKind, string> = {
  catalog: "Catalog Intelligence",
  gallery: "Products Gallery",
  visualizer: "Products Visualizer",
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
    return `/w/${slug}/import/${params.sessionId}/enrich`;
  }
  if (params.kind === "gallery") {
    return `/w/${slug}/products-gallery?project=${encodeURIComponent(params.sessionId)}`;
  }
  return `/w/${slug}/products-visualizer?project=${encodeURIComponent(params.sessionId)}`;
}
