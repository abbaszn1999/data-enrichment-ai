import fs from "node:fs/promises";
import path from "node:path";

/**
 * Sync's own system instruction for product classification. Deliberately not
 * shared with Market Research's skill files (`market-research/skills/*.md`):
 * the two features hand the model a different task shape — Market Research
 * validates a pre-filtered candidate shortlist, Sync sees every live category
 * directly with no shortlist — so a shared prompt would drift out of sync
 * with one feature's edits silently changing the other's behavior.
 */
const SKILL_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "growth-sync",
  "skills",
  "classify.md"
);

let cached: string | null = null;

export async function loadClassifySkill(): Promise<string> {
  if (cached !== null) return cached;
  cached = (await fs.readFile(SKILL_PATH, "utf-8")).trim();
  return cached;
}
