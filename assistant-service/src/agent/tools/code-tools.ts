import { promises as fs } from "node:fs";
import path from "node:path";

export const CODE_LIMITS = {
  maxFileBytes: 200 * 1024,
  maxReadLines: 400,
  maxListEntries: 200,
  maxSearchResults: 60,
  maxSearchFileBytes: 400 * 1024,
  maxSearchedFiles: 4000,
} as const;

/** Names the agent can never list, read or search, even inside the knowledge folder. */
const BLOCKED_NAME = /(^|[\\/])(\.env[^\\/]*|.*\.pem|.*\.key|.*\.p12|.*secret.*|.*credentials.*|\.git|node_modules)([\\/]|$)/i;

export class PathError extends Error {}

/**
 * Resolve a user-supplied relative path inside `root`. Rejects absolute paths,
 * traversal, symlinks that leave the root and blocked names.
 */
export async function resolveInside(root: string, requested: string): Promise<string> {
  const cleaned = requested.trim().replace(/^[\\/]+/, "");
  if (cleaned.includes("\0")) throw new PathError("Invalid path");
  if (/^[a-zA-Z]:/.test(cleaned)) throw new PathError("Absolute paths are not allowed");
  if (BLOCKED_NAME.test(cleaned)) throw new PathError("This path is not available");
  const rootReal = await fs.realpath(root);
  const target = path.resolve(rootReal, cleaned || ".");
  if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
    throw new PathError("Path is outside the knowledge folder");
  }
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw new PathError("Path not found");
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new PathError("Path is outside the knowledge folder");
  }
  if (BLOCKED_NAME.test(path.relative(rootReal, real))) throw new PathError("This path is not available");
  return real;
}

export async function listDir(root: string, requested: string): Promise<string> {
  const dir = await resolveInside(root, requested || ".");
  const stat = await fs.stat(dir);
  if (!stat.isDirectory()) throw new PathError("Not a directory");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const rows = entries
    .filter((entry) => !BLOCKED_NAME.test(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, CODE_LIMITS.maxListEntries)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  return rows.length ? rows.join("\n") : "(empty)";
}

export async function readFile(root: string, requested: string, startLine = 1, endLine?: number): Promise<string> {
  const file = await resolveInside(root, requested);
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new PathError("Not a file");
  if (stat.size > CODE_LIMITS.maxFileBytes * 4) throw new PathError("File is too large to read");
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  const from = Math.max(1, Math.floor(startLine));
  const to = Math.min(lines.length, Math.floor(endLine ?? from + CODE_LIMITS.maxReadLines - 1), from + CODE_LIMITS.maxReadLines - 1);
  const body = lines
    .slice(from - 1, to)
    .map((line, index) => `${from + index}|${line}`)
    .join("\n");
  const note = to < lines.length ? `\n[showing lines ${from}-${to} of ${lines.length}; pass startLine/endLine for more]` : "";
  return body.slice(0, CODE_LIMITS.maxFileBytes) + note;
}

export async function searchCode(root: string, pattern: string, subdir = "."): Promise<string> {
  if (!pattern || pattern.length > 200) throw new PathError("Pattern must be 1 to 200 characters");
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const start = await resolveInside(root, subdir);
  const rootReal = await fs.realpath(root);
  const results: string[] = [];
  let scanned = 0;

  async function walk(dir: string): Promise<void> {
    if (results.length >= CODE_LIMITS.maxSearchResults || scanned >= CODE_LIMITS.maxSearchedFiles) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= CODE_LIMITS.maxSearchResults) return;
      if (BLOCKED_NAME.test(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        scanned += 1;
        if (scanned > CODE_LIMITS.maxSearchedFiles) return;
        const stat = await fs.stat(full);
        if (stat.size > CODE_LIMITS.maxSearchFileBytes) continue;
        const text = await fs.readFile(full, "utf8").catch(() => "");
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && results.length < CODE_LIMITS.maxSearchResults; i += 1) {
          const line = lines[i] ?? "";
          if (regex.test(line)) {
            results.push(`${path.relative(rootReal, full).split(path.sep).join("/")}:${i + 1}: ${line.trim().slice(0, 200)}`);
          }
        }
      }
    }
  }

  const stat = await fs.stat(start);
  if (stat.isDirectory()) await walk(start);
  return results.length ? results.join("\n") : "No matches";
}
