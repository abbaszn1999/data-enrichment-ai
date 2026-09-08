import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_INTELLIGENCE,
  STORE_ASSISTANT,
  WALLET_MODULE,
  catalogIntelligencePath,
  storeAssistantPath,
} from "./product-modules";

const ROOT = join(__dirname, "../..");

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".next",
  "backups",
  "dist",
  "coverage",
]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (/\.(ts|tsx|js|mjs|md)$/.test(name)) acc.push(full);
  }
  return acc;
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

describe("Section 19 naming constants", () => {
  it("exposes the final Catalog Intelligence and Store Assistant identifiers", () => {
    expect(CATALOG_INTELLIGENCE.table).toBe("catalog_sessions");
    expect(CATALOG_INTELLIGENCE.creditOperation).toBe("catalog_intelligence");
    expect(catalogIntelligencePath("acme", "sess-1")).toBe(
      "/w/acme/catalog-intelligence/sess-1"
    );
    expect(STORE_ASSISTANT.creditOperation).toBe("store_assistant");
    expect(storeAssistantPath("acme")).toBe("/w/acme/store-assistant");
    expect(WALLET_MODULE.growthSync).toBe("growth-sync");
    expect(WALLET_MODULE.marketResearch).toBe("market-research");
  });

  it("keeps retired ledger and URL identifiers out of live source", () => {
    const hits: string[] = [];
    for (const file of walk(join(ROOT, "src")).concat(
      walk(join(ROOT, ".cursor/skills"))
    )) {
      const path = rel(file);
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
      if (path.startsWith("src/lib/sync/")) continue;
      if (path.includes("supabase/migrations/")) continue;
      const text = readFileSync(file, "utf8");
      if (/\bai_enrichment\b/.test(text)) hits.push(`${path} :: ai_enrichment`);
      if (/\bsync_agent\b/.test(text) && !path.includes("sync_agent_traces")) {
        hits.push(`${path} :: sync_agent`);
      }
      if (/\bimport_sessions\b/.test(text)) hits.push(`${path} :: import_sessions`);
      if (/\/w\/\$\{[^}]+\}\/import\//.test(text) || /\/w\/[^/\s]+\/import\//.test(text)) {
        hits.push(`${path} :: /import/ url`);
      }
      if (/["']\/api\/import\//.test(text) || /["']\/api\/enrich/.test(text)) {
        hits.push(`${path} :: retired catalog API`);
      }
      if (/["']\/api\/sync\//.test(text)) hits.push(`${path} :: retired store-assistant API`);
      if (/GROWTH_SYNC_WALLET_MODULE\s*=\s*["']Sync["']/.test(text)) {
        hits.push(`${path} :: wallet module Sync`);
      }
      if (/MARKET_RESEARCH_WALLET_MODULE\s*=\s*["']Market Research["']/.test(text)) {
        hits.push(`${path} :: wallet module Market Research`);
      }
    }
    expect(hits).toEqual([]);
  });
});
