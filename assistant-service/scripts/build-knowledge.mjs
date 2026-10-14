// Builds the read-only knowledge folder the assistant reads: a filtered copy of the
// platform source plus the assistant's own instructions (AGENTS.md, rules, skills).
// Fails the build if anything that looks like a secret ends up in the copy.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, "..");
const repoRoot = path.resolve(serviceRoot, "..");
const out = path.resolve(serviceRoot, process.env.ASSISTANT_KNOWLEDGE_DIR ?? "knowledge");

const COPY_DIRS = ["src/app", "src/components", "src/lib", "src/store", "src/hooks"];
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "__tests__", "__mocks__"]);
const SKIP_FILE = /(\.test\.|\.spec\.)|(^\.env)|\.(pem|key|p12|png|jpg|jpeg|gif|webp|ico|woff2?|mp4|zip)$/i;
const SECRET_NAME = /secret|credential/i;
const SECRET_CONTENT = [
  /sk-[A-Za-z0-9_-]{24,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
];

function copyTree(from, to, stats) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      copyTree(path.join(from, entry.name), path.join(to, entry.name), stats);
    } else if (entry.isFile()) {
      if (SKIP_FILE.test(entry.name) || SECRET_NAME.test(entry.name)) continue;
      const target = path.join(to, entry.name);
      cpSync(path.join(from, entry.name), target);
      stats.files += 1;
    }
  }
}

function scan(dir, problems) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(full, problems);
    } else if (statSync(full).size < 2_000_000) {
      const text = readFileSync(full, "utf8");
      for (const pattern of SECRET_CONTENT) {
        if (pattern.test(text)) problems.push(`${path.relative(out, full)} matches ${pattern}`);
      }
    }
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const stats = { files: 0 };
for (const dir of COPY_DIRS) {
  const from = path.join(repoRoot, dir);
  if (existsSync(from)) copyTree(from, path.join(out, dir), stats);
}

// The assistant's own instructions: AGENTS.md at the root, rules and skills under .cursor/.
const instructions = path.join(serviceRoot, "knowledge-src");
if (existsSync(instructions)) cpSync(instructions, out, { recursive: true });

const problems = [];
scan(out, problems);
if (problems.length > 0) {
  rmSync(out, { recursive: true, force: true });
  console.error("Knowledge build failed: possible secrets found:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log(`Knowledge ready: ${stats.files} source files -> ${path.relative(process.cwd(), out) || out}`);
