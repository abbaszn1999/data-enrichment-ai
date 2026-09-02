import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import { normalizeStoreDomain } from "@/lib/embed/store-domain";
import { lookupWorkspaceIdByStoreDomain } from "@/lib/embed/workspace-domains";
import {
  recordEmbedLatencyMs,
  recordResponseBytes,
  jsonByteLength,
} from "@/lib/observability/metrics";
import type {
  CollectionContent,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

function slugify(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const finish = (body: unknown, init: { status?: number } = {}) => {
    recordEmbedLatencyMs(Date.now() - started);
    recordResponseBytes("embed.content", jsonByteLength(body));
    return NextResponse.json(body, { status: init.status, headers: CORS_HEADERS });
  };

  try {
    const { searchParams } = new URL(request.url);
    const rawDomain =
      searchParams.get("domain") || searchParams.get("shop") || searchParams.get("store");
    const rawCollection = searchParams.get("collection") || searchParams.get("handle");

    if (!rawDomain) {
      return finish(
        { error: "Missing required query parameter: domain" },
        { status: 400 }
      );
    }

    const cleanDomain = normalizeStoreDomain(rawDomain);

    let rawHandle = (rawCollection || "").toLowerCase().trim();
    // Strip URL prefix and common shopify/woo paths if passed
    rawHandle = rawHandle
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/(collections|product-category)\//, "")
      .replace(/^collections\//, "")
      .replace(/\/+$/, "");

    const cleanHandle = slugify(rawHandle);

    const admin = createAdminClient();

    // Exact indexed lookup only. Never scan workspace_integrations and never
    // select `config` (live store credentials) on this public endpoint.
    const matchedWorkspaceId = await lookupWorkspaceIdByStoreDomain(
      admin,
      cleanDomain
    );

    if (!matchedWorkspaceId) {
      console.warn("[embed/content] No matching workspace found for domain:", cleanDomain);
      return finish(
        { error: "No matching workspace found for store domain", domain: cleanDomain, faqs: [], links: [] },
        { status: 404 }
      );
    }

    if (!cleanHandle || cleanHandle === "current") {
      return finish({ faqs: [], links: [] });
    }

    const { data: cached } = await admin
      .from("embed_page_cache")
      .select("payload")
      .eq("workspace_id", matchedWorkspaceId)
      .eq("domain", cleanDomain)
      .eq("handle", cleanHandle)
      .maybeSingle();
    if (cached?.payload && typeof cached.payload === "object") {
      return finish(cached.payload);
    }

    // 2. Fetch workspace collection prefix & custom widget settings if any
    const { data: wsRow } = await admin
      .from("workspaces")
      .select("collection_prefix, widget_settings")
      .eq("id", matchedWorkspaceId)
      .maybeSingle();

    const prefix = (wsRow?.collection_prefix ?? "AI").trim() || "AI";
    const widgetSettings = wsRow?.widget_settings;

    // 3. Find recent active projects in this workspace
    const { data: projects } = await admin
      .from("mr_projects")
      .select("id, name, updated_at")
      .eq("workspace_id", matchedWorkspaceId)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!projects || projects.length === 0) {
      return finish({ faqs: [], links: [] });
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

        if (Object.keys(contentMap).length === 0) continue;

        // Exact-match only. `storeHandle` is the handle the store itself assigned
        // at push time (including any "-1" dedupe suffix), so it is authoritative.
        // The prefixed-slug comparison is a fallback for projects pushed before
        // handles were persisted; it still requires a full exact match.
        for (const col of collections) {
          const candidates = new Set<string>();
          if (col.storeHandle) candidates.add(slugify(col.storeHandle));
          candidates.add(slugify(`${prefix} ${col.name}`));
          candidates.add(slugify(`${prefix} - ${col.name}`));

          if (candidates.has(cleanHandle) && contentMap[col.id]) {
            matchedContent = contentMap[col.id];
            break;
          }
        }

        if (matchedContent) break;
      } catch (e) {
        console.error(`[embed/content] Error loading slices for project ${proj.id}:`, e);
      }
    }

    if (!matchedContent) {
      return finish({ faqs: [], links: [] });
    }

    const payload = {
      collectionId: matchedContent.collectionId,
      seoTitle: matchedContent.seoTitle,
      seoDescription: matchedContent.seoDescription,
      collectionDescription: matchedContent.collectionDescription,
      faqs: Array.isArray(matchedContent.faqs) ? matchedContent.faqs : [],
      links: Array.isArray(matchedContent.links) ? matchedContent.links : [],
      widgetSettings: widgetSettings || null,
    };
    await admin.from("embed_page_cache").upsert({
      workspace_id: matchedWorkspaceId,
      domain: cleanDomain,
      handle: cleanHandle,
      payload,
      updated_at: new Date().toISOString(),
    });
    return finish(payload);
  } catch (error) {
    console.error("[embed/content] Unexpected error:", error);
    return finish(
      { error: "Internal server error", faqs: [], links: [] },
      { status: 500 }
    );
  }
}
