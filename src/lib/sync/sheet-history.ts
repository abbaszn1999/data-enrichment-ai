export type SheetSnapshot = {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
};

export type SheetCellPatch = {
  rowIndex: number;
  key: string;
  value: unknown;
};

export type CompactSheetSnapshot =
  | { kind: "full"; title: string; columns: string[]; rows: Record<string, unknown>[] }
  | {
      kind: "patch";
      title: string;
      columns: string[];
      patches: SheetCellPatch[];
      rowCount: number;
    };

const PATCH_BLOWUP = 4;

export function compactFromTo(from: SheetSnapshot, to: SheetSnapshot): CompactSheetSnapshot {
  if (
    from.columns.length !== to.columns.length ||
    from.columns.some((col, i) => col !== to.columns[i]) ||
    from.rows.length !== to.rows.length
  ) {
    return {
      kind: "full",
      title: from.title,
      columns: from.columns,
      rows: from.rows,
    };
  }

  const patches: SheetCellPatch[] = [];
  for (let i = 0; i < from.rows.length; i++) {
    const prev = from.rows[i] ?? {};
    const next = to.rows[i] ?? {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
      if (!Object.is(prev[key], next[key])) {
        patches.push({ rowIndex: i, key, value: prev[key] });
      }
    }
  }

  if (patches.length > from.rows.length * PATCH_BLOWUP) {
    return {
      kind: "full",
      title: from.title,
      columns: from.columns,
      rows: from.rows,
    };
  }

  return {
    kind: "patch",
    title: from.title,
    columns: from.columns,
    patches,
    rowCount: from.rows.length,
  };
}

export function restoreSnapshot(
  current: SheetSnapshot,
  snapshot: CompactSheetSnapshot
): SheetSnapshot {
  if (snapshot.kind === "full") {
    return {
      title: snapshot.title,
      columns: snapshot.columns,
      rows: snapshot.rows,
    };
  }

  const rows = current.rows.map((row) => ({ ...row }));
  for (const patch of snapshot.patches) {
    const row = rows[patch.rowIndex];
    if (!row) continue;
    if (patch.value === undefined) delete row[patch.key];
    else row[patch.key] = patch.value;
  }
  return {
    title: snapshot.title,
    columns: snapshot.columns,
    rows,
  };
}
