import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentPath } from "../../../src/lib/store-agent/file-kinds";
import { mentionedIds } from "../../../src/lib/store-agent/mentions";
import { STORE_AGENT_LIMITS } from "../../../src/lib/store-agent/protocol";
import { decodeStoragePath } from "../../../src/lib/store-agent/storage-key";

const MAX_PLAN_CHARS = 20_000;
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;

export type MentionContext = { notes: string[]; images: Array<{ data: string; mimeType: string }> };

/** The tables or text an attachment was converted into, beside it in attachments/. */
async function convertedFrom(cwd: string, name: string): Promise<string[]> {
  const base = path.posix.basename(attachmentPath(name)).replace(/\.[^.]+$/, "");
  try {
    const entries = await fs.readdir(path.join(cwd, "attachments"));
    return entries
      .filter((e) => e === `${base}.csv` || e === `${base}.txt` || (e.startsWith(`${base} - `) && e.endsWith(".csv")))
      .map((e) => `attachments/${e}`);
  } catch {
    return [];
  }
}

/**
 * Files and plans of this chat the user @-mentioned: where each file is in
 * the agent's folder (an image is also shown to it), and a plan's text.
 * Only this chat's files and plans are looked up.
 */
export async function mentionContext(db: SupabaseClient, chatId: string, cwd: string, message: string): Promise<MentionContext> {
  const ids = mentionedIds(message);
  const out: MentionContext = { notes: [], images: [] };
  if (!ids.files.length && !ids.plans.length) return out;

  const [files, plans] = await Promise.all([
    ids.files.length
      ? db.from("store_agent_files").select("id, name, mime, size, storage_path, created_by").eq("chat_id", chatId).in("id", ids.files)
      : { data: [] },
    ids.plans.length ? db.from("store_agent_plans").select("id, title, content, version").eq("chat_id", chatId).in("id", ids.plans) : { data: [] },
  ]);

  const lines: string[] = [];
  for (const f of (files.data ?? []) as Array<{ name: string; mime: string; size: number; storage_path: string; created_by: string }>) {
    const relative = decodeStoragePath(String(f.storage_path).split("/").slice(2).join("/"));
    const converted = f.created_by === "user" ? await convertedFrom(cwd, f.name) : [];
    let line = `- "${f.name}": ${relative} in your folder`;
    if (converted.length) line += `; read it as ${converted.join(", ")}`;
    if (IMAGE_MIME.test(f.mime) && Number(f.size) <= STORE_AGENT_LIMITS.maxImageBytes) {
      try {
        const bytes = await fs.readFile(path.join(cwd, ...relative.split("/")));
        out.images.push({ data: bytes.toString("base64"), mimeType: f.mime });
        line += " (the image is attached to this message, so you can see it)";
      } catch {
        // not in the folder: the path is still right
      }
    }
    lines.push(line);
  }
  if (lines.length) out.notes.push(`The user mentioned these files from this chat:\n${lines.join("\n")}`);

  for (const p of (plans.data ?? []) as Array<{ title: string; content: string; version: number }>) {
    const content = p.content.length > MAX_PLAN_CHARS ? `${p.content.slice(0, MAX_PLAN_CHARS)}\n…` : p.content;
    out.notes.push(`The user mentioned the plan "${p.title}" (version ${p.version}). Its text:\n${content}`);
  }
  return out;
}
