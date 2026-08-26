import type { SessionKind } from "@/types";
import type { EnrichColumnConfig } from "../types";
import type { ColumnSpec } from "./types";
import { genericTextSpec } from "./shared/text";
import { productColumnSpecs } from "./product";
import { plpColumnSpecs } from "./plp";

const SPECS_BY_KIND: Record<SessionKind, Map<string, ColumnSpec>> = {
  product: new Map(productColumnSpecs.map((s) => [s.id, s])),
  plp: new Map(plpColumnSpecs.map((s) => [s.id, s])),
};

/**
 * Resolve the spec for a column. Unknown ids (custom user columns) fall back to
 * the generic text/list spec so they still get a schema property and a prompt
 * line without needing a dedicated file.
 */
export function getColumnSpec(
  kind: SessionKind,
  columnId: string
): ColumnSpec {
  return SPECS_BY_KIND[kind]?.get(columnId) ?? genericTextSpec;
}

/** True when a dedicated spec exists, i.e. the column is native to this kind. */
export function hasColumnSpec(kind: SessionKind, columnId: string): boolean {
  return SPECS_BY_KIND[kind]?.has(columnId) === true;
}

export function listColumnSpecs(kind: SessionKind): ColumnSpec[] {
  return kind === "plp" ? plpColumnSpecs : productColumnSpecs;
}

/**
 * Pair each enabled column id with its config and spec, in the order the user
 * arranged them. Columns with no config still resolve, using id as the label.
 */
export function resolveEnabledColumns(
  kind: SessionKind,
  enabledColumns: string[],
  enrichmentColumns: EnrichColumnConfig[] | undefined
): Array<{ id: string; col: EnrichColumnConfig; spec: ColumnSpec }> {
  const byId = new Map((enrichmentColumns || []).map((c) => [c.id, c]));
  return enabledColumns.filter(Boolean).map((id) => {
    const col: EnrichColumnConfig =
      byId.get(id) ?? {
        id,
        label: id,
        description: `Value for ${id}`,
        type: "text",
        enabled: true,
      };
    return { id, col, spec: getColumnSpec(kind, id) };
  });
}

export type { ColumnSpec, SpecContext, ColumnNeeds } from "./types";
