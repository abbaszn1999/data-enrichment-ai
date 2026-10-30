import os from "node:os";
import path from "node:path";

/**
 * The Cursor SDK (1.2.0) does not return a tool result over 40,000 bytes: it
 * writes it to ~/.cursor/projects/<cwd as a slug>/agent-tools/<id>.txt and
 * gives the agent only that path. Our tools stay under this budget, in bytes
 * (Arabic text is two bytes a character), so the agent gets their output.
 */
export const INLINE_RESULT_BYTES = 36_000;

export const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

/** The start of `text` within `bytes`, never cutting a character in half. */
export function clipToBytes(text: string, bytes: number): string {
  if (byteLength(text) <= bytes) return text;
  return Buffer.from(text, "utf8").subarray(0, bytes).toString("utf8").replace(/�+$/, "");
}

/** The folder where the SDK saves those results for an agent working in `cwd` (the SDK's own naming). */
export function sdkToolOutputDir(cwd: string): string {
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return path.join(os.homedir(), ".cursor", "projects", slug, "agent-tools");
}

const OUTPUT_FILE = /^[\w-]{1,80}\.txt$/;

/**
 * The saved result the agent was pointed at, if `requested` names one of this
 * chat's (by full path or file name). Other chats' saved results stay out of reach.
 */
export function sdkToolOutputPath(cwd: string, requested: unknown): string | null {
  if (typeof requested !== "string") return null;
  const name = path.basename(requested.replace(/\\/g, "/"));
  if (!OUTPUT_FILE.test(name)) return null;
  const dir = sdkToolOutputDir(cwd);
  const candidate = path.join(dir, name);
  const isPath = requested.includes("/") || requested.includes("\\");
  if (!isPath) return candidate;
  const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  return same(path.resolve(requested), candidate) ? candidate : null;
}
