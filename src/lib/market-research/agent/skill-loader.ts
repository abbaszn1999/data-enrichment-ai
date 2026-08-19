import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export type MrThinkingLevel = "low" | "medium" | "high";

export interface SkillFrontmatter {
  id: string;
  stage: number;
  thinking: MrThinkingLevel;
  tools: string[];
  output: string;
}

export interface MarketResearchSkill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  rawMarkdown: string;
}

const SKILLS_DIR = path.join(process.cwd(), "src", "lib", "market-research", "skills");

const STAGE_TO_FILE: Record<number, string> = {
  1: "01-niches.md",
  2: "02-catalog.md",
  3: "03-seeds.md",
  4: "04-extract.md",
  5: "05-collections.md",
  6: "06-on-page.md",
  7: "07-strategy.md",
};

const skillCache = new Map<string, MarketResearchSkill>();

export function parseSkillMarkdown(content: string, filename = ""): MarketResearchSkill {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid skill frontmatter in file: ${filename}`);
  }

  const rawYaml = match[1];
  const body = match[2].trim();
  const parsed = yaml.load(rawYaml) as Partial<SkillFrontmatter>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to parse YAML frontmatter in: ${filename}`);
  }

  if (typeof parsed.stage !== "number" || !parsed.id) {
    throw new Error(`Skill ${filename} is missing required stage or id in frontmatter`);
  }

  const rawThinking = String(parsed.thinking || "medium").toLowerCase();
  if (rawThinking === "minimal") {
    throw new Error(
      `Gemini 3.7 Flash rejects 'minimal' thinking_level. Invalid config in ${filename}`
    );
  }

  if (!["low", "medium", "high"].includes(rawThinking)) {
    throw new Error(`Invalid thinking level '${rawThinking}' in skill ${filename}`);
  }

  const thinking = rawThinking as MrThinkingLevel;
  const tools = Array.isArray(parsed.tools) ? parsed.tools.map(String) : [];
  const output = String(parsed.output || "");

  const frontmatter: SkillFrontmatter = {
    id: parsed.id,
    stage: parsed.stage,
    thinking,
    tools,
    output,
  };

  return {
    frontmatter,
    instructions: body,
    rawMarkdown: content,
  };
}

export async function loadSkill(stageOrId: number | string): Promise<MarketResearchSkill> {
  let cacheKey = String(stageOrId);
  if (skillCache.has(cacheKey)) {
    return skillCache.get(cacheKey)!;
  }

  let filename: string;
  if (typeof stageOrId === "number") {
    filename = STAGE_TO_FILE[stageOrId];
    if (!filename) {
      throw new Error(`No skill registered for stage ${stageOrId}`);
    }
  } else {
    filename = stageOrId.endsWith(".md") ? stageOrId : `${stageOrId}.md`;
  }

  const filePath = path.join(SKILLS_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  const skill = parseSkillMarkdown(content, filename);

  skillCache.set(String(skill.frontmatter.stage), skill);
  skillCache.set(skill.frontmatter.id, skill);

  return skill;
}

export async function getAllSkills(): Promise<MarketResearchSkill[]> {
  const skills: MarketResearchSkill[] = [];
  for (let stage = 1; stage <= 7; stage++) {
    skills.push(await loadSkill(stage));
  }
  return skills;
}
