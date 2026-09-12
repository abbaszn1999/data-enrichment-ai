export type DuplicateMatch = { id: string; name: string };

export type DuplicateExclusionResult = {
  duplicateIds: Set<string>;
  matchesById: Map<string, DuplicateMatch[]>;
};

type RawDuplicateItem = {
  id?: unknown;
  status?: unknown;
  existingId?: unknown;
  existingName?: unknown;
  matches?: unknown;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pushMatch(
  out: DuplicateMatch[],
  seen: Set<string>,
  match: DuplicateMatch | null
) {
  if (!match || seen.has(match.id)) return;
  seen.add(match.id);
  out.push(match);
}

function resolveMatch(
  id: string,
  name: string,
  existingById: Map<string, string>
): DuplicateMatch | null {
  if (!id) return null;
  const resolvedName = name || existingById.get(id) || "";
  if (!resolvedName && !existingById.has(id)) {
    // Unknown existing id with no name — still keep it if we have an id,
    // but skip nameless unknowns that we cannot show in the popup.
    return null;
  }
  return { id, name: resolvedName || id };
}

/**
 * Parses the Stage 5 Phase 3 Gemini payload. Flagging requires only `id`.
 * `existingId` / `existingName` / `matches` are optional — omit them and the
 * collection is still a duplicate, just without a clickable PLP popup.
 */
export function parseDuplicateExclusionResponse(
  data: unknown,
  validNewIds: Set<string>,
  existingById: Map<string, string>
): DuplicateExclusionResult {
  const duplicateIds = new Set<string>();
  const matchesById = new Map<string, DuplicateMatch[]>();
  if (!data || typeof data !== "object") {
    return { duplicateIds, matchesById };
  }
  const duplicates = (data as { duplicates?: unknown }).duplicates;
  if (!Array.isArray(duplicates)) {
    return { duplicateIds, matchesById };
  }

  for (const raw of duplicates) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as RawDuplicateItem;
    const id = asTrimmedString(item.id);
    if (!id || !validNewIds.has(id)) continue;
    duplicateIds.add(id);

    const collected: DuplicateMatch[] = [];
    const seen = new Set<string>();
    pushMatch(
      collected,
      seen,
      resolveMatch(
        asTrimmedString(item.existingId),
        asTrimmedString(item.existingName),
        existingById
      )
    );
    if (Array.isArray(item.matches)) {
      for (const match of item.matches) {
        if (!match || typeof match !== "object") continue;
        const m = match as { id?: unknown; name?: unknown };
        pushMatch(
          collected,
          seen,
          resolveMatch(asTrimmedString(m.id), asTrimmedString(m.name), existingById)
        );
      }
    }
    if (collected.length > 0) {
      const prev = matchesById.get(id) ?? [];
      const merged: DuplicateMatch[] = [];
      const mergedSeen = new Set<string>();
      for (const match of [...prev, ...collected]) {
        pushMatch(merged, mergedSeen, match);
      }
      matchesById.set(id, merged);
    }
  }

  return { duplicateIds, matchesById };
}
