import { NextRequest, NextResponse } from "next/server";
import { loadCategoriesJsonServer } from "@/lib/storage-helpers-server";
import type { CategoryJson } from "@/lib/storage-helpers";
import type { CategoryItem } from "@/types";

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

    console.log(`[Categories API] Returning ${categoryItems.length} categories (${rootCategories.length} root)`);

    return NextResponse.json({
      categories: categoryItems,
      tree,
    });
  } catch (err: any) {
    console.error("[Categories API] Unexpected error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
