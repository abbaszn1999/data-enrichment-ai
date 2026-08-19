import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { loadProjectSliceAdmin } from "@/lib/market-research/storage-admin";
import type {
  CollectionContent,
  ProposedCollection,
} from "@/components/market-research/workspace-data";

function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

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
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawDomain =
      searchParams.get("domain") || searchParams.get("shop") || searchParams.get("store");
    const rawCollection = searchParams.get("collection") || searchParams.get("handle");

    if (!rawDomain) {
      return NextResponse.json(
        { error: "Missing required query parameter: domain" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const cleanDomain = normalizeDomain(rawDomain);

    let rawHandle = (rawCollection || "").toLowerCase().trim();
    // Strip URL prefix and common shopify/woo paths if passed
    rawHandle = rawHandle
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/^\/(collections|product-category)\//, "")
      .replace(/^collections\//, "")
      .replace(/\/+$/, "");

    const cleanHandle = slugify(rawHandle);

    const admin = createAdminClient();

    // 1. Find connected integration matching this store domain
    const { data: integrations, error: integErr } = await admin
      .from("workspace_integrations")
      .select("workspace_id, provider, base_url, config");

    if (integErr) {
      console.error("[embed/content] Database error fetching integrations:", integErr);
    }

    let matchedWorkspaceId: string | null = null;

    if (integrations && integrations.length > 0) {
      // Pass 1: Exact domain match (highest priority)
      for (const integ of integrations) {
        const baseDomain = normalizeDomain(integ.base_url);
        const cfg = (integ.config && typeof integ.config === "object" ? integ.config : {}) as Record<string, unknown>;
        const cfgStoreDomain = normalizeDomain(
          String(cfg.store_domain || cfg.shop || cfg.store_url || cfg.url || "")
        );

        const candidates = [baseDomain, cfgStoreDomain].filter(Boolean);
        if (candidates.some((c) => c === cleanDomain)) {
          matchedWorkspaceId = integ.workspace_id;
          break;
        }
      }

      // Pass 2: Hostname / subdomain match (only for non-trivial strings)
      if (!matchedWorkspaceId) {
        for (const integ of integrations) {
          const baseDomain = normalizeDomain(integ.base_url);
          const cfg = (integ.config && typeof integ.config === "object" ? integ.config : {}) as Record<string, unknown>;
          const cfgStoreDomain = normalizeDomain(
            String(cfg.store_domain || cfg.shop || cfg.store_url || cfg.url || "")
          );

          const candidates = [baseDomain, cfgStoreDomain].filter((c) => c && c.length >= 4);
          if (
            cleanDomain.length >= 4 &&
            candidates.some((c) => c.includes(cleanDomain) || cleanDomain.includes(c))
          ) {
            matchedWorkspaceId = integ.workspace_id;
            break;
          }
        }
      }
    }

    if (!matchedWorkspaceId) {
      console.warn("[embed/content] No matching workspace found for domain:", cleanDomain);
      return NextResponse.json(
        { error: "No matching workspace found for store domain", domain: cleanDomain, faqs: [], links: [] },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // 2. Fetch workspace collection prefix & custom widget settings if any
    const { data: wsRow } = await admin
      .from("workspaces")
      .select("collection_prefix, widget_settings")
      .eq("id", matchedWorkspaceId)
      .maybeSingle();

    const prefix = (wsRow?.collection_prefix ?? "AI").trim() || "AI";
    const prefixSlug = slugify(prefix);
    const widgetSettings = wsRow?.widget_settings;

    // 3. Find recent active projects in this workspace
    const { data: projects } = await admin
      .from("mr_projects")
      .select("id, name, updated_at")
      .eq("workspace_id", matchedWorkspaceId)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!projects || projects.length === 0) {
      return NextResponse.json(
        { faqs: [], links: [] },
        { headers: CORS_HEADERS }
      );
    }

    let matchedContent: CollectionContent | null = null;
    let fallbackContent: CollectionContent | null = null;

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

        const contentEntries = Object.entries(contentMap);
        if (contentEntries.length === 0) continue;

        // Keep first available content item as fallback in case collection handle wasn't passed or is generic
        if (!fallbackContent && contentEntries.length > 0) {
          fallbackContent = contentEntries[0][1];
        }

        // If no handle provided, or handle is "current" / template, use the first content item from newest project
        if (!cleanHandle || cleanHandle === "current") {
          matchedContent = contentEntries[0][1];
          break;
        }

        // 1. Try matching with collection metadata in collections slice
        for (const col of collections) {
          const colSlug = slugify(col.name);
          const headSlug = slugify(col.headKeyword || "");
          const idSlug = slugify(col.id.replace(/^col-/, ""));
          const prefixedSlug = slugify(`${prefix} ${col.name}`);
          const handleWithoutPrefix = cleanHandle.replace(new RegExp(`^${prefixSlug}-?`), "");

          const isMatch =
            cleanHandle === prefixedSlug ||
            cleanHandle === colSlug ||
            cleanHandle === headSlug ||
            cleanHandle === idSlug ||
            handleWithoutPrefix === colSlug ||
            handleWithoutPrefix === headSlug ||
            (colSlug && cleanHandle.includes(colSlug)) ||
            (colSlug && colSlug.includes(cleanHandle)) ||
            (headSlug && headSlug.includes(handleWithoutPrefix)) ||
            (handleWithoutPrefix && headSlug.includes(handleWithoutPrefix));

          if (isMatch && contentMap[col.id]) {
            matchedContent = contentMap[col.id];
            break;
          }
        }

        // 2. Direct matching on content slice keys and fields
        if (!matchedContent) {
          for (const [colId, content] of contentEntries) {
            const keySlug = slugify(colId.replace(/^col-/, ""));
            const titleSlug = content.seoTitle ? slugify(content.seoTitle) : "";
            const handleWithoutPrefix = cleanHandle.replace(new RegExp(`^${prefixSlug}-?`), "");

            const isMatch =
              cleanHandle === keySlug ||
              handleWithoutPrefix === keySlug ||
              cleanHandle.includes(keySlug) ||
              keySlug.includes(cleanHandle) ||
              (titleSlug && titleSlug.includes(handleWithoutPrefix)) ||
              (titleSlug && handleWithoutPrefix.includes(titleSlug));

            if (isMatch) {
              matchedContent = content;
              break;
            }
          }
        }

        if (matchedContent) break;
      } catch (e) {
        console.error(`[embed/content] Error loading slices for project ${proj.id}:`, e);
      }
    }

    // If still no direct match and handle was not specific, use fallback
    if (!matchedContent && (!cleanHandle || cleanHandle === "current")) {
      matchedContent = fallbackContent;
    }

    if (!matchedContent) {
      return NextResponse.json(
        { faqs: [], links: [] },
        { headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      {
        collectionId: matchedContent.collectionId,
        seoTitle: matchedContent.seoTitle,
        seoDescription: matchedContent.seoDescription,
        collectionDescription: matchedContent.collectionDescription,
        faqs: Array.isArray(matchedContent.faqs) ? matchedContent.faqs : [],
        links: Array.isArray(matchedContent.links) ? matchedContent.links : [],
        widgetSettings: widgetSettings || null,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[embed/content] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error", faqs: [], links: [] },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
