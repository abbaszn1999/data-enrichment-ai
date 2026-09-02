export type CategoryRef = {
  id: string;
  name: string;
  parentId: string | null;
};

export type CountedCategory = CategoryRef & {
  children: CountedCategory[];
  productCount: number;
  directCount: number;
};

export function categoryPathKey(
  cat: CategoryRef,
  byId: Map<string, CategoryRef>
): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: CategoryRef | undefined = cat;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join("\0").toLowerCase();
}

/** Ancestors of each id (not including self). Lookup is O(1) after build. */
export function buildAncestorSets(
  categories: CategoryRef[]
): Map<string, Set<string>> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const cache = new Map<string, Set<string>>();

  const ancestorsOf = (id: string): Set<string> => {
    const hit = cache.get(id);
    if (hit) return hit;
    const set = new Set<string>();
    const cat = byId.get(id);
    if (cat?.parentId) {
      set.add(cat.parentId);
      for (const ancestor of ancestorsOf(cat.parentId)) set.add(ancestor);
    }
    cache.set(id, set);
    return set;
  };

  for (const cat of categories) ancestorsOf(cat.id);
  return cache;
}

/** True when `targetId` sits under `parentId` (would create a cycle if reparented). */
export function isDescendantOf(
  parentId: string,
  targetId: string,
  ancestorSets: Map<string, Set<string>>
): boolean {
  return ancestorSets.get(targetId)?.has(parentId) ?? false;
}

export function rollupProductCounts(
  categories: CategoryRef[],
  direct: Record<string, number>
): Map<string, { direct: number; rollup: number }> {
  const children = new Map<string, string[]>();
  for (const cat of categories) {
    if (!cat.parentId) continue;
    const list = children.get(cat.parentId) ?? [];
    list.push(cat.id);
    children.set(cat.parentId, list);
  }

  const result = new Map<string, { direct: number; rollup: number }>();
  const walking = new Set<string>();

  const walk = (id: string): number => {
    const cached = result.get(id);
    if (cached) return cached.rollup;
    if (walking.has(id)) return direct[id] ?? 0;
    walking.add(id);
    const own = direct[id] ?? 0;
    let rollup = own;
    for (const childId of children.get(id) ?? []) {
      rollup += walk(childId);
    }
    walking.delete(id);
    result.set(id, { direct: own, rollup });
    return rollup;
  };

  for (const cat of categories) walk(cat.id);
  return result;
}

export function buildCountedTree<T extends CategoryRef>(
  categories: T[],
  counts: Map<string, { direct: number; rollup: number }>
): Array<T & { children: Array<T & { children: unknown[]; productCount: number; directCount: number }>; productCount: number; directCount: number }> {
  type Node = T & {
    children: Node[];
    productCount: number;
    directCount: number;
  };
  const map = new Map<string, Node>();
  const roots: Node[] = [];

  for (const cat of categories) {
    const tally = counts.get(cat.id);
    map.set(cat.id, {
      ...cat,
      children: [],
      productCount: tally?.rollup ?? 0,
      directCount: tally?.direct ?? 0,
    });
  }

  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parentId && map.has(cat.parentId)) {
      map.get(cat.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export type FlatTreeRow<T> = { node: T; depth: number };

export function flattenExpanded<T extends { id: string; children: T[] }>(
  roots: T[],
  expanded: Set<string>
): FlatTreeRow<T>[] {
  const out: FlatTreeRow<T>[] = [];
  const walk = (nodes: T[], depth: number) => {
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.children.length > 0 && expanded.has(node.id)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(roots, 0);
  return out;
}

export function collectExpandableIds<T extends { id: string; children: T[] }>(
  roots: T[]
): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: T[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        ids.add(node.id);
        walk(node.children);
      }
    }
  };
  walk(roots);
  return ids;
}
