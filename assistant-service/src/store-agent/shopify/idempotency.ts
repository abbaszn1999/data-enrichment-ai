import { randomUUID } from "node:crypto";
import { Kind, parse, print, type DirectiveNode, type OperationDefinitionNode, type VariableDefinitionNode } from "graphql";

/**
 * Admin API 2026-04 refuses these mutations without `@idempotent(key: …)`.
 * The agent should not have to know: the directive is added here, keyed by a
 * variable so every execution (and every row of a bulk change) gets its own
 * key while a retried request reuses the one it was sent with.
 */
export const IDEMPOTENT_MUTATIONS = new Set([
  "inventoryActivate",
  "inventoryAdjustQuantities",
  "inventoryMoveQuantities",
  "inventorySetQuantities",
  "locationActivate",
  "locationDeactivate",
]);

export const IDEMPOTENCY_VARIABLE = "autommerceIdempotencyKey";

/**
 * The document with the directive on every root field that needs it, or null
 * when nothing needs it (or it is already there).
 */
export function withIdempotency(document: string): string | null {
  const ast = parse(document);
  let changed = false;
  const definitions = ast.definitions.map((def) => {
    if (def.kind !== Kind.OPERATION_DEFINITION || def.operation !== "mutation") return def;
    // Shopify only takes the directive on the field; drop one put on the operation.
    if (def.directives?.some((d) => d.name.value === "idempotent")) {
      changed = true;
      def = { ...def, directives: def.directives.filter((d) => d.name.value !== "idempotent") };
    }
    const selections = def.selectionSet.selections.map((sel) => {
      if (sel.kind !== Kind.FIELD || !IDEMPOTENT_MUTATIONS.has(sel.name.value)) return sel;
      if (sel.directives?.some((d) => d.name.value === "idempotent")) return sel;
      changed = true;
      const directive: DirectiveNode = {
        kind: Kind.DIRECTIVE,
        name: { kind: Kind.NAME, value: "idempotent" },
        arguments: [
          {
            kind: Kind.ARGUMENT,
            name: { kind: Kind.NAME, value: "key" },
            value: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: IDEMPOTENCY_VARIABLE } },
          },
        ],
      };
      return { ...sel, directives: [...(sel.directives ?? []), directive] };
    });
    const hasVariable = def.variableDefinitions?.some((v) => v.variable.name.value === IDEMPOTENCY_VARIABLE);
    const variable: VariableDefinitionNode = {
      kind: Kind.VARIABLE_DEFINITION,
      variable: { kind: Kind.VARIABLE, name: { kind: Kind.NAME, value: IDEMPOTENCY_VARIABLE } },
      type: { kind: Kind.NON_NULL_TYPE, type: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: "String" } } },
    };
    return {
      ...def,
      variableDefinitions: hasVariable ? def.variableDefinitions : [...(def.variableDefinitions ?? []), variable],
      selectionSet: { ...def.selectionSet, selections },
    } as OperationDefinitionNode;
  });
  return changed ? print({ ...ast, definitions }) : null;
}

/** Variables for one execution of a document from {@link withIdempotency}. */
export function idempotencyVariables<T extends Record<string, unknown> | null | undefined>(variables: T): Record<string, unknown> {
  return { ...(variables ?? {}), [IDEMPOTENCY_VARIABLE]: randomUUID() };
}
