// Loads Product Visualizer's agent skill prompts from versioned markdown
// files, mirroring `src/lib/website-restructure/skill-loader.ts` — YAML
// frontmatter + a markdown body, cached per-process. Skill 01 is the
// description/art-director call; skill 02 is the photographer that executes
// each slot's brief against the real product photo.

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type VisualizerSkillThinking = "low" | "medium" | "high";

export interface VisualizerSkillFrontmatter {
  id: string;
  order: number;
  thinking: VisualizerSkillThinking;
  /** One-line description of what this call outputs, for humans reading the file. */
  output: string;
}

export interface VisualizerSkill {
  frontmatter: VisualizerSkillFrontmatter;
  instructions: string;
  rawMarkdown: string;
}

const SKILLS_DIR = path.join(process.cwd(), "src", "lib", "visualizer", "skills");

export type VisualizerSkillId = "description" | "image";

// These files are read at runtime, so they must also be listed in
// `outputFileTracingIncludes` (next.config.ts) or they are missing from a
// traced production build.
const ID_TO_FILE: Record<VisualizerSkillId, string> = {
  description: "01-description.md",
  image: "02-image.md",
};

const skillCache = new Map<string, VisualizerSkill>();

export function parseVisualizerSkillMarkdown(
  content: string,
  filename = ""
): VisualizerSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid skill frontmatter in file: ${filename}`);
  }

  const rawYaml = match[1];
  const body = match[2].trim();
  const parsed = yaml.load(rawYaml) as Partial<VisualizerSkillFrontmatter>;

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

  const frontmatter: VisualizerSkillFrontmatter = {
    id: parsed.id,
    order: parsed.order,
    thinking: rawThinking as VisualizerSkillThinking,
    output: String(parsed.output || ""),
  };

  return { frontmatter, instructions: body, rawMarkdown: content };
}

export async function loadVisualizerSkill(id: VisualizerSkillId): Promise<VisualizerSkill> {
  if (skillCache.has(id)) return skillCache.get(id)!;

  const filename = ID_TO_FILE[id];
  if (!filename) throw new Error(`No skill registered for id "${id}"`);

  const filePath = path.join(SKILLS_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  const skill = parseVisualizerSkillMarkdown(content, filename);

  skillCache.set(id, skill);
  return skill;
}

export async function getAllVisualizerSkills(): Promise<VisualizerSkill[]> {
  const ids = Object.keys(ID_TO_FILE) as VisualizerSkillId[];
  const skills: VisualizerSkill[] = [];
  for (const id of ids) {
    skills.push(await loadVisualizerSkill(id));
  }
  return skills.sort((a, b) => a.frontmatter.order - b.frontmatter.order);
}
