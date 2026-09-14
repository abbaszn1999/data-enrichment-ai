// Loads Gallery AI planner + photographer skill prompts from versioned
// markdown files, mirroring `src/lib/visualizer/skill-loader.ts` — YAML
// frontmatter + a markdown body, cached per-process.

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type GallerySkillThinking = "low" | "medium" | "high";

export interface GallerySkillFrontmatter {
  id: string;
  order: number;
  thinking: GallerySkillThinking;
  output: string;
}

export interface GallerySkill {
  frontmatter: GallerySkillFrontmatter;
  instructions: string;
  rawMarkdown: string;
}

const SKILLS_DIR = path.join(process.cwd(), "src", "lib", "gallery", "skills");

export type GallerySkillId = "planner" | "image";

const ID_TO_FILE: Record<GallerySkillId, string> = {
  planner: "01-planner.md",
  image: "02-image.md",
};

const skillCache = new Map<string, GallerySkill>();

export function parseGallerySkillMarkdown(
  content: string,
  filename = ""
): GallerySkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid skill frontmatter in file: ${filename}`);
  }

  const rawYaml = match[1];
  const body = match[2].trim();
  const parsed = yaml.load(rawYaml) as Partial<GallerySkillFrontmatter>;

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

  const frontmatter: GallerySkillFrontmatter = {
    id: parsed.id,
    order: parsed.order,
    thinking: rawThinking as GallerySkillThinking,
    output: String(parsed.output || ""),
  };

  return { frontmatter, instructions: body, rawMarkdown: content };
}

export async function loadGallerySkill(id: GallerySkillId): Promise<GallerySkill> {
  if (skillCache.has(id)) return skillCache.get(id)!;

  const filename = ID_TO_FILE[id];
  if (!filename) throw new Error(`No skill registered for id "${id}"`);

  const filePath = path.join(SKILLS_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  const skill = parseGallerySkillMarkdown(content, filename);

  skillCache.set(id, skill);
  return skill;
}

export async function getAllGallerySkills(): Promise<GallerySkill[]> {
  const ids = Object.keys(ID_TO_FILE) as GallerySkillId[];
  const skills: GallerySkill[] = [];
  for (const id of ids) {
    skills.push(await loadGallerySkill(id));
  }
  return skills.sort((a, b) => a.frontmatter.order - b.frontmatter.order);
}
