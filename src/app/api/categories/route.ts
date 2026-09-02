import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import {
  getWorkspaceContext,
  isContextSubscriptionActive,
} from "@/lib/workspace-context";
import {
  loadCategoriesJsonServer,
  loadCategoriesRawJsonServer,
  saveJsonToStorageServer,
  loadJsonFromStorageServer,
} from "@/lib/storage-helpers-server";
import {
  getCategoriesRawStoragePath,
  getCategoriesStoragePath,
  type CategoryJson,
} from "@/lib/storage-helpers";
import type { CategoryItem } from "@/types";
function categoriesMetaPath(workspaceId: string) {
  return `${workspaceId}/categories.meta.json`;
}

async function loadCategoriesRevision(workspaceId: string): Promise<number> {
  try {
    const meta = await loadJsonFromStorageServer<{ revision?: number }>(
      categoriesMetaPath(workspaceId)
    );
    return typeof meta?.revision === "number" ? meta.revision : 0;
  } catch {
    return 0;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  console.log(`[Categories API] Loading categories.json for workspace: ${workspaceId}`);

  try {
    // Load categories from Storage (categories.json)
    const rawCategories = await loadCategoriesJsonServer(workspaceId);

    console.log(`[Categories API] Found ${rawCategories.length} categories in storage`);

    if (rawCategories.length === 0) {
      return NextResponse.json({ categories: [], tree: [] });
    }

    // Build a lookup map for parent names
    const idMap = new Map<string, CategoryJson>();
    for (const cat of rawCategories) {
      idMap.set(cat.id, cat);
    }

    // Build full path for each category
    function buildFullPath(cat: CategoryJson): string {
      const parts: string[] = [cat.name];
      let current = cat;
      while (current.parentId && idMap.has(current.parentId)) {
        current = idMap.get(current.parentId)!;
        parts.unshift(current.name);
      }
      return parts.join(" > ");
    }

    // Convert to CategoryItem format
    const categoryItems: CategoryItem[] = rawCategories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      parentId: cat.parentId ?? null,
      originalId: cat.originalId ?? null,
      parentName: cat.parentId ? idMap.get(cat.parentId)?.name : undefined,
      fullPath: buildFullPath(cat),
    }));

    // Build a tree structure for UI
    const rootCategories: CategoryItem[] = [];
    const childrenMap = new Map<string, CategoryItem[]>();

    for (const item of categoryItems) {
      if (item.parentId) {
        if (!childrenMap.has(item.parentId)) {
          childrenMap.set(item.parentId, []);
        }
        childrenMap.get(item.parentId)!.push(item);
      } else {
        rootCategories.push(item);
      }
    }

    function attachChildren(items: CategoryItem[]): CategoryItem[] {
      return items.map((item) => ({
        ...item,
        children: childrenMap.has(item.id)
          ? attachChildren(childrenMap.get(item.id)!)
          : undefined,
      }));
    }

    const tree = attachChildren(rootCategories);

    // Also load raw sheet rows for BigCommerce AI reference
    const rawRows = await loadCategoriesRawJsonServer(workspaceId);
    const revision = await loadCategoriesRevision(workspaceId);

    console.log(`[Categories API] Returning ${categoryItems.length} categories (${rootCategories.length} root), ${rawRows.length} raw rows`);

    return NextResponse.json({
      categories: categoryItems,
      tree,
      rawRows,
      revision,
    });
  } catch (err: any) {
    console.error("[Categories API] Unexpected error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  let body: {
    workspaceId?: string;
    categories?: CategoryJson[];
    rawRows?: Record<string, string>[];
    expectedRevision?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId?.trim();
  const categories = Array.isArray(body.categories) ? body.categories : null;
  if (!workspaceId || !categories) {
    return NextResponse.json(
      { error: "workspaceId and categories are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ctx = await getWorkspaceContext({ workspaceId, userId: user.id });
  if (!ctx.membershipRole || ctx.membershipRole === "viewer") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!ctx.subscription || !isContextSubscriptionActive(ctx)) {
    return NextResponse.json({ error: "INACTIVE_SUBSCRIPTION" }, { status: 402 });
  }

  const currentRevision = await loadCategoriesRevision(workspaceId);
  if (
    typeof body.expectedRevision === "number" &&
    body.expectedRevision !== currentRevision
  ) {
    return NextResponse.json(
      {
        code: "REVISION_CONFLICT",
        error: "Someone else changed this taxonomy. Reload and try again.",
        currentRevision,
      },
      { status: 409 }
    );
  }

  const nextRevision = currentRevision + 1;
  await saveJsonToStorageServer(getCategoriesStoragePath(workspaceId), categories);
  if (Array.isArray(body.rawRows)) {
    await saveJsonToStorageServer(getCategoriesRawStoragePath(workspaceId), body.rawRows);
  }
  await saveJsonToStorageServer(categoriesMetaPath(workspaceId), {
    revision: nextRevision,
    ts: Date.now(),
  });
  await saveJsonToStorageServer(`${workspaceId}/categories.count.json`, {
    count: categories.length,
    ts: Date.now(),
  });

  return NextResponse.json({ ok: true, revision: nextRevision, count: categories.length });
}
