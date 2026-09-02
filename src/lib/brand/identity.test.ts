import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import {
  CRAWLER_USER_AGENT,
  PRODUCT_FULL_NAME,
  PRODUCT_NAME,
  PRODUCT_TAGLINE,
} from "./tokens";

const ROOT = join(__dirname, "../../..");

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
    if (/\.(ts|tsx|js|mjs|md|json)$/.test(name)) acc.push(full);
  }
  return acc;
}

function rel(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

describe("Section 18 identity gate", () => {
  it("keeps a single canonical product name", () => {
    expect(PRODUCT_NAME).toBe("Autommerce");
    expect(PRODUCT_FULL_NAME).toBe("Autommerce Platform");
    expect(PRODUCT_TAGLINE).toBe("AI Commerce Operations");
    expect(CRAWLER_USER_AGENT).toContain("AutommerceBot/1.0");
    expect(CRAWLER_USER_AGENT).toContain("https://platform.autommerce.com/bot");
  });

  it("does not reintroduce retired brand strings in live source", () => {
    const banned = [/DataSheet/, /Data Entry/, /data-enrichment-ai/, /data-sheet/];
    const hits: string[] = [];
    const files = walk(join(ROOT, "src"))
      .concat(walk(join(ROOT, "public")))
      .concat([
        join(ROOT, "package.json"),
        join(ROOT, "README.md"),
        join(ROOT, ".cursor/skills/import-enrichment-openai/SKILL.md"),
        join(ROOT, ".cursor/skills/sync-pro-openai-web/SKILL.md"),
      ]);

    for (const file of files) {
      const path = rel(file);
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
      if (path.includes("supabase/migrations/")) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        if (pattern.test(text)) hits.push(`${path} :: ${pattern}`);
      }
    }

    expect(hits).toEqual([]);
  });
});
