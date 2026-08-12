import { describe, it, expect } from "vitest";
import { buildFunctionDeclarations } from "./agent-loop";
import {
  buildProviderToolContext,
  buildToolSchemasForProvider,
} from "./tool-catalog";

/**
 * Gemini's implicit cache matches on the exact serialized request prefix, and
 * tool declarations are part of that prefix. Any per-request variation in the
 * declarations — including key order that carries no meaning — is a guaranteed
 * cache miss, so the serialization must be byte-stable.
 */
function buildFor(provider: "shopify" | "woocommerce") {
  const providerCtx = buildProviderToolContext(provider);
  return buildFunctionDeclarations({
    webEnabled: false,
    hasAttachments: false,
    providerCtx,
    schemas: buildToolSchemasForProvider(providerCtx),
  });
}

/** Every `properties` object found anywhere in the declaration tree. */
function collectPropertyKeyLists(node: unknown, out: string[][] = []): string[][] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectPropertyKeyLists(item, out);
    return out;
  }
  const record = node as Record<string, unknown>;
  if (record.properties && typeof record.properties === "object") {
    out.push(Object.keys(record.properties as Record<string, unknown>));
  }
  for (const value of Object.values(record)) collectPropertyKeyLists(value, out);
  return out;
}

describe("gemini function declarations", () => {
  it("reuses one declaration set per tool surface", () => {
    // Same surface → same object, so the serialized bytes cannot drift between
    // requests handled by this process.
    expect(buildFor("shopify")).toBe(buildFor("shopify"));
    expect(buildFor("woocommerce")).toBe(buildFor("woocommerce"));
  });

  it("orders every property object deterministically", () => {
    for (const provider of ["shopify", "woocommerce"] as const) {
      for (const keys of collectPropertyKeyLists(buildFor(provider))) {
        expect(keys).toEqual([...keys].sort());
      }
    }
  });

  it("orders required lists deterministically", () => {
    const load = buildFor("shopify").find((d) => d.name === "sync_products_load");
    const write = buildFor("shopify").find(
      (d) => d.name === "sync_columns_write_with_ai"
    );
    expect(load?.parameters.required).toEqual(["columnProfile"]);
    expect(write?.parameters.required).toEqual([
      "instruction",
      "overwrite",
      "scopeCap",
      "targetColumn",
    ]);
  });

  it("keeps the two providers' surfaces distinct", () => {
    expect(JSON.stringify(buildFor("shopify"))).not.toBe(
      JSON.stringify(buildFor("woocommerce"))
    );
  });
});
