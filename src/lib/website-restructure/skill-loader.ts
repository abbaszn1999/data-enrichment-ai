// Loads Website Restructure's Gemini skill prompts from versioned markdown
// files, mirroring `src/lib/free-assessment/agent/skill-loader.ts` — YAML
// frontmatter + a markdown body, cached per-process. Keeping skills as files
// (not inline TS template strings) makes each one reviewable/versionable on
// its own and matches the progressive-disclosure pattern used across the
// rest of the codebase's Gemini agents.

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type WrThinkingLevel = "low" | "medium" | "high";

export interface WrSkillFrontmatter {
  id: string;
  order: number;
  thinking: WrThinkingLevel;
  /** One-line description of what this call outputs, for humans reading the file. */
  output: string;
}

export interface WrSkill {
  frontmatter: WrSkillFrontmatter;
  instructions: string;
  rawMarkdown: string;
}

const SKILLS_DIR = path.join(process.cwd(), "src", "lib", "website-restructure", "skills");

export type WrSkillId = "vision" | "competitor-research" | "ia-planner" | "header-builder";

// These files are read at runtime, so they must also be listed in
// `outputFileTracingIncludes` (next.config.ts) or they are missing from a
// traced production build.
const ID_TO_FILE: Record<WrSkillId, string> = {
  vision: "01-vision.md",
  "competitor-research": "02-competitor-research.md",
  "ia-planner": "03-ia-planner.md",
  "header-builder": "04-header-builder.md",
};

const skillCache = new Map<string, WrSkill>();

export function parseWrSkillMarkdown(content: string, filename = ""): WrSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid skill frontmatter in file: ${filename}`);
  }

  const rawYaml = match[1];
  const body = match[2].trim();
  const parsed = yaml.load(rawYaml) as Partial<WrSkillFrontmatter>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to parse YAML frontmatter in: ${filename}`);
  }
  if (!parsed.id || typeof parsed.order !== "number") {
    throw new Error(`Skill ${filename} is missing required id or order in frontmatter`);
  }

  const rawThinking = String(parsed.thinking || "medium").toLowerCase();
  if (!["low", "medium", "high"].includes(rawThinking)) {
    throw new Error(`Invalid thinking level '${rawThinking}' in skill ${filename}`);
  }

  const frontmatter: WrSkillFrontmatter = {
    id: parsed.id,
    order: parsed.order,
    thinking: rawThinking as WrThinkingLevel,
    output: String(parsed.output || ""),
  };

  return { frontmatter, instructions: body, rawMarkdown: content };
}

export async function loadWrSkill(id: WrSkillId): Promise<WrSkill> {
  if (skillCache.has(id)) return skillCache.get(id)!;

  const filename = ID_TO_FILE[id];
  if (!filename) throw new Error(`No skill registered for id "${id}"`);

  const filePath = path.join(SKILLS_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  const skill = parseWrSkillMarkdown(content, filename);

  skillCache.set(id, skill);
  return skill;
}

export async function getAllWrSkills(): Promise<WrSkill[]> {
  const ids = Object.keys(ID_TO_FILE) as WrSkillId[];
  const skills: WrSkill[] = [];
  for (const id of ids) {
    skills.push(await loadWrSkill(id));
  }
  return skills.sort((a, b) => a.frontmatter.order - b.frontmatter.order);
}
