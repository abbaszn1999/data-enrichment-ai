import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type {
  CollectionContent,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const domain =
      searchParams.get("domain") || searchParams.get("shop") || searchParams.get("store");
    const collection = searchParams.get("collection") || searchParams.get("handle");

    if (!domain) {
      return NextResponse.json(
        { error: "Missing required query parameter: domain" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const cleanDomain = domain
      .toLowerCase()
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");

    let rawHandle = (collection || "").toLowerCase().trim();
    // Strip common path parts if user passed full pathname
    rawHandle = rawHandle
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/(collections|product-category)\//, "")
      .replace(/^collections\//, "")
      .replace(/\/+$/, "");

    const cleanHandle = slugify(rawHandle);

    const admin = createAdminClient();

    // Look for a connected integration matching this store domain
    const { data: integrations } = await admin
      .from("workspace_integrations")
      .select("workspace_id, base_url, config");

    let matchedWorkspaceId: string | null = null;

    if (integrations && integrations.length > 0) {
      for (const integ of integrations) {
        const base = (integ.base_url || "").toLowerCase();
        let cfgUrl = "";
        if (integ.config && typeof integ.config === "object") {
          const cfg = integ.config as Record<string, unknown>;
          cfgUrl = String(cfg.store_url || cfg.url || "").toLowerCase();
        }

        if (
          base.includes(cleanDomain) ||
          cleanDomain.includes(base) ||
          cfgUrl.includes(cleanDomain) ||
          cleanDomain.includes(cfgUrl)
        ) {
          matchedWorkspaceId = integ.workspace_id;
          break;
        }
      }
    }

    if (!matchedWorkspaceId) {
      return NextResponse.json(
        { error: "No matching workspace found for store domain" },
        { status: 404, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Fetch workspace collection prefix if any
    const { data: wsRow } = await admin
      .from("workspaces")
      .select("collection_prefix")
      .eq("id", matchedWorkspaceId)
      .maybeSingle();

    const prefix = (wsRow?.collection_prefix ?? "AI").trim() || "AI";
    const prefixSlug = slugify(prefix);

    // Find recent active projects in this workspace
    const { data: projects } = await admin
      .from("mr_projects")
      .select("id")
      .eq("workspace_id", matchedWorkspaceId)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (!projects || projects.length === 0) {
      return NextResponse.json(
        { faqs: [], links: [] },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    let matchedContent: CollectionContent | null = null;

    for (const proj of projects) {
      try {
        const [collectionsSlice, contentSlice] = await Promise.all([
          loadProjectSliceAdmin<ProposedCollection[]>(
            admin,
            matchedWorkspaceId,
            proj.id,
            "collections"
          ).catch(() => [] as ProposedCollection[]),
          loadProjectSliceAdmin<Record<string, CollectionContent>>(
            admin,
            matchedWorkspaceId,
            proj.id,
            "content"
          ).catch(() => ({}) as Record<string, CollectionContent>),
        ]);

        const collections = Array.isArray(collectionsSlice) ? collectionsSlice : [];
        const contentMap =
          contentSlice && typeof contentSlice === "object" ? contentSlice : {};

        // 1. Try finding matching collection in collections slice
        for (const col of collections) {
          const colSlug = slugify(col.name);
          const headSlug = slugify(col.headKeyword || "");
          const idSlug = slugify(col.id.replace(/^col-/, ""));
          const prefixedSlug = slugify(`${prefix} ${col.name}`);

          const handleWithoutPrefix = cleanHandle.replace(new RegExp(`^${prefixSlug}-?`), "");

          if (
            cleanHandle === prefixedSlug ||
            cleanHandle === colSlug ||
            cleanHandle === headSlug ||
            cleanHandle === idSlug ||
            handleWithoutPrefix === colSlug ||
            handleWithoutPrefix === headSlug ||
            (colSlug && cleanHandle.includes(colSlug)) ||
            (colSlug && colSlug.includes(cleanHandle))
          ) {
            if (contentMap[col.id]) {
              matchedContent = contentMap[col.id];
              break;
            }
          }
        }

        // 2. Direct lookup in contentMap keys if not matched yet
        if (!matchedContent) {
          for (const [colId, content] of Object.entries(contentMap)) {
            const keySlug = slugify(colId.replace(/^col-/, ""));
            const titleSlug = content.seoTitle ? slugify(content.seoTitle) : "";

            if (
              cleanHandle === keySlug ||
              cleanHandle.includes(keySlug) ||
              keySlug.includes(cleanHandle) ||
              (titleSlug && titleSlug.includes(cleanHandle))
            ) {
              matchedContent = content;
              break;
            }
          }
        }

        if (matchedContent) break;
      } catch {
        // Continue to next project if error reading slices
      }
    }

    if (!matchedContent) {
      return NextResponse.json(
        { faqs: [], links: [] },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    return NextResponse.json(
      {
        collectionId: matchedContent.collectionId,
        faqs: matchedContent.faqs || [],
        links: matchedContent.links || [],
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
