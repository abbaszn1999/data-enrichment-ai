import {
  Kind,
  parse,
  type DocumentNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValueNode,
} from "graphql";
import {
  ALLOWED_GID_TYPES,
  FORBIDDEN_FIELDS,
  MUTATION_ROOTS,
  QUERY_ROOTS,
  type OperationRisk,
  type StoreAgentScope,
} from "./scopes";

export type GuardVerdict =
  | {
      ok: true;
      kind: "query" | "mutation";
      /** The highest risk among the root fields. */
      risk: OperationRisk;
      /** Root field names, in document order. */
      operations: string[];
      requiredScopes: StoreAgentScope[];
      /** Every Shopify id the document names, from literals and variables. */
      ids: string[];
    }
  | { ok: false; reason: string };

const RISK_ORDER: OperationRisk[] = ["read", "write", "delete", "bulk"];
const GID = /gid:\/\/shopify\/([A-Za-z0-9]+)\/[^\s"'\\]+/g;
const MAX_DOCUMENT_CHARS = 50_000;
const MAX_DEPTH = 15;

const deny = (reason: string): GuardVerdict => ({ ok: false, reason });

/**
 * Decide whether a GraphQL document may be sent to the store, and how much
 * the user must be involved. Deny by default: an unknown root field, a
 * forbidden field anywhere, an id of a type outside the agent's scopes, or a
 * document we cannot fully inspect is refused.
 */
export function inspectShopifyDocument(document: string, variables?: Record<string, unknown> | null): GuardVerdict {
  if (typeof document !== "string" || !document.trim()) return deny("The GraphQL document is empty.");
  if (document.length > MAX_DOCUMENT_CHARS) return deny("The GraphQL document is too large.");

  let ast: DocumentNode;
  try {
    ast = parse(document);
  } catch (error) {
    return deny(`The GraphQL document does not parse: ${(error as Error).message}`);
  }

  const operations = ast.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION);
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const d of ast.definitions) {
    if (d.kind === Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d);
    else if (d.kind !== Kind.OPERATION_DEFINITION) return deny("Only queries, mutations and fragments are allowed.");
  }
  if (operations.length !== 1) return deny("Send exactly one query or mutation per call.");
  const op = operations[0]!;
  if (op.operation === "subscription") return deny("Subscriptions are not available.");

  const roots = op.operation === "mutation" ? MUTATION_ROOTS : QUERY_ROOTS;
  const rootNames: string[] = [];
  const scopes = new Set<StoreAgentScope>();
  let risk: OperationRisk = "read";

  // Root fields (fragments spread at the root are expanded too).
  const rootFields: Array<{ name: string; arguments: readonly { value: ValueNode; name: { value: string } }[] }> = [];
  const collectRoot = (set: SelectionSetNode, seen: Set<string>): string | null => {
    for (const sel of set.selections) {
      if (sel.kind === Kind.FIELD) rootFields.push({ name: sel.name.value, arguments: sel.arguments ?? [] });
      else if (sel.kind === Kind.INLINE_FRAGMENT) {
        const err = collectRoot(sel.selectionSet, seen);
        if (err) return err;
      } else {
        const name = sel.name.value;
        if (seen.has(name)) return "Fragment cycle.";
        const frag = fragments.get(name);
        if (!frag) return `Unknown fragment ${name}.`;
        const err = collectRoot(frag.selectionSet, new Set([...seen, name]));
        if (err) return err;
      }
    }
    return null;
  };
  const rootErr = collectRoot(op.selectionSet, new Set());
  if (rootErr) return deny(rootErr);

  for (const field of rootFields) {
    const name = field.name;
    if (name === "__typename" || name === "__schema" || name === "__type") {
      rootNames.push(name);
      continue;
    }
    const rule = roots[name];
    if (!rule) {
      return deny(
        `"${name}" is not available: either the Admin API has no such root field, or it is outside what this agent can access ` +
          "(it works with products, collections, inventory, locations, files and sales channels only). " +
          `If you meant something in those areas, look up the exact name with shopify_schema ("QueryRoot" or "Mutation").`
      );
    }
    rootNames.push(name);
    if (rule.scope) scopes.add(rule.scope);
    if (RISK_ORDER.indexOf(rule.risk) > RISK_ORDER.indexOf(risk)) risk = rule.risk;

    // Bulk operations carry a second document as an argument: check it as well.
    if (name === "bulkOperationRunQuery" || name === "bulkOperationRunMutation") {
      const arg = field.arguments.find((a) => a.name.value === (name === "bulkOperationRunQuery" ? "query" : "mutation"));
      const inner = arg ? valueToJs(arg.value, variables) : undefined;
      if (typeof inner !== "string") return deny(`${name} needs its inner document as a string.`);
      const verdict = inspectShopifyDocument(inner, null);
      if (!verdict.ok) return deny(`Inside ${name}: ${verdict.reason}`);
      const expected = name === "bulkOperationRunQuery" ? "query" : "mutation";
      if (verdict.kind !== expected) return deny(`${name} must wrap a ${expected}.`);
      for (const s of verdict.requiredScopes) scopes.add(s);
      // The inner mutation runs once per line of the uploaded file, so the
      // ids it touches are not in this document: always ask the user.
    }
  }

  // Forbidden fields anywhere, and a depth limit.
  const forbidden = findForbiddenField(op.selectionSet, fragments, 0, new Set());
  if (forbidden) return deny(forbidden);

  // Every id named in the document or its variables must be an allowed type.
  const ids = new Set<string>();
  for (const match of `${document}\n${safeStringify(variables)}`.matchAll(GID)) {
    const type = match[1]!;
    if (!ALLOWED_GID_TYPES.has(type)) {
      return deny(`The agent cannot access ${type} records. It works with products, collections, inventory, locations, files and sales channels only.`);
    }
    ids.add(match[0]);
  }

  return {
    ok: true,
    kind: op.operation === "mutation" ? "mutation" : "query",
    risk,
    operations: rootNames,
    requiredScopes: [...scopes],
    ids: [...ids],
  };
}

function findForbiddenField(
  set: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  depth: number,
  seen: Set<string>
): string | null {
  if (depth > MAX_DEPTH) return "The query is nested too deeply.";
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      if (FORBIDDEN_FIELDS.has(sel.name.value)) {
        return `"${sel.name.value}" is outside what this agent can access on the store.`;
      }
      if (sel.selectionSet) {
        const err = findForbiddenField(sel.selectionSet, fragments, depth + 1, seen);
        if (err) return err;
      }
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      const err = findForbiddenField(sel.selectionSet, fragments, depth, seen);
      if (err) return err;
    } else {
      const name = sel.name.value;
      if (seen.has(name)) continue;
      const frag = fragments.get(name);
      if (!frag) return `Unknown fragment ${name}.`;
      const err = findForbiddenField(frag.selectionSet, fragments, depth, new Set([...seen, name]));
      if (err) return err;
    }
  }
  return null;
}

function valueToJs(value: ValueNode, variables?: Record<string, unknown> | null): unknown {
  switch (value.kind) {
    case Kind.VARIABLE:
      return variables?.[value.name.value];
    case Kind.STRING:
    case Kind.ENUM:
      return value.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(value.value);
    case Kind.BOOLEAN:
      return value.value;
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return value.values.map((v) => valueToJs(v, variables));
    case Kind.OBJECT:
      return Object.fromEntries(value.fields.map((f) => [f.name.value, valueToJs(f.value, variables)]));
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "";
  }
}

/** Scopes the store must have granted for this verdict, minus those implied by a write scope. */
export function missingScopes(required: readonly StoreAgentScope[], granted: ReadonlySet<string>): StoreAgentScope[] {
  return required.filter((scope) => {
    if (granted.has(scope)) return false;
    // Shopify: write_x implies read_x.
    if (scope.startsWith("read_") && granted.has(scope.replace(/^read_/, "write_"))) return false;
    return true;
  });
}
