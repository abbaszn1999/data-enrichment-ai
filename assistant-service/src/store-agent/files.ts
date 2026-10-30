import { promises as fs } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentPath, classifyAgentFile, type AgentFolder } from "../../../src/lib/store-agent/file-kinds";
import { decodeStoragePath, encodeStoragePath } from "../../../src/lib/store-agent/storage-key";
import type { StoreAgentRun } from "./run";

export const FILES_BUCKET = "store-agent-files";
const SKIP_DIRS = new Set(["node_modules", ".git", ".cursor"]);
const MAX_SYNC_BYTES = 25 * 1024 * 1024;

const KIND_BY_EXT: Record<string, string> = {
  ".md": "report",
  ".html": "report",
  ".htm": "report",
  ".csv": "csv",
  ".tsv": "csv",
  ".xlsx": "csv",
  ".docx": "report",
  ".pdf": "report",
  ".json": "table",
  ".jsonl": "table",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".svg": "image",
};

const MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  // One JSON object per line: shown as plain text.
  ".jsonl": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function mimeFor(name: string): string {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

export function kindFor(name: string): string {
  const base = path.basename(name).toLowerCase();
  if (base.startsWith("plan")) return "plan";
  return KIND_BY_EXT[path.extname(name).toLowerCase()] ?? "other";
}

/** Resolve a path the agent gave, refusing anything outside its folder. */
export function resolveInChat(cwd: string, relative: string): string {
  const target = path.resolve(cwd, relative);
  const rel = path.relative(cwd, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("That path is outside this chat's files.");
  return target;
}

type Known = { id: string; size: number; mtimeMs: number; shown: boolean; fromStore: boolean; folder: AgentFolder | null };

/**
 * A chat's working folder on disk, mirrored to Storage. The agent reads and
 * writes plain files there; whatever it creates becomes a chat file the user
 * can open on the right. Files the agent puts in front of the user (opens, or
 * makes for them) are marked `shown`: they are results; the rest are its
 * working files, which the panel keeps out of the way.
 */
export class ChatFiles {
  private readonly known = new Map<string, Known>();
  /** Files the agent asked to show whose upload has not gone through yet. */
  private readonly pendingOpen = new Set<string>();
  /** Files made for the user (not opened) to mark as results at the next sync. */
  private readonly pendingShown = new Set<string>();

  /** Show this file once a later sync manages to upload it. */
  openWhenSynced(relative: string) {
    this.pendingOpen.add(relative);
  }

  /** Files whose data came from the store, kept when they are written again. */
  private readonly pendingFromStore = new Set<string>();
  /** Which folder the agent says a file belongs in, for what the platform cannot tell. */
  private readonly folderHints = new Map<string, string>();

  /** The store's data, or made from it. */
  isFromStore(relative: string): boolean {
    return /^(exports|shopify-results|woo-results)\//.test(relative) || !!this.known.get(relative)?.fromStore || this.pendingFromStore.has(relative);
  }

  markFromStore(relative: string) {
    this.pendingFromStore.add(relative);
  }

  setFolderHint(relative: string, folder: string) {
    this.folderHints.set(relative, folder);
  }

  /** A result for the user, listed with the results but not opened (an Excel file to download). */
  markShown(relative: string) {
    this.pendingShown.add(relative);
  }

  constructor(
    private readonly db: SupabaseClient,
    readonly cwd: string,
    private readonly workspaceId: string,
    private readonly chatId: string
  ) {}

  storagePath(relative: string): string {
    return `${this.workspaceId}/${this.chatId}/${encodeStoragePath(relative.split(path.sep).join("/"))}`;
  }

  /** Create the folder and bring back files from earlier runs of this chat. */
  async prepare(): Promise<void> {
    await fs.mkdir(this.cwd, { recursive: true });
    const { data, error } = await this.db
      .from("store_agent_files")
      .select("id, storage_path, size, shown, from_store, folder")
      .eq("chat_id", this.chatId);
    if (error) throw new Error(`Could not load chat files: ${error.message}`);
    const prefix = this.storagePath("");
    for (const row of data ?? []) {
      const relative = String(row.storage_path).startsWith(prefix) ? decodeStoragePath(String(row.storage_path).slice(prefix.length)) : null;
      if (!relative) continue;
      const saved = { shown: !!row.shown, fromStore: !!row.from_store, folder: (row.folder ?? null) as AgentFolder | null };
      const local = path.join(this.cwd, ...relative.split("/"));
      try {
        const stat = await fs.stat(local);
        this.known.set(relative, { id: row.id, size: stat.size, mtimeMs: stat.mtimeMs, ...saved });
        continue;
      } catch {
        // not on this machine yet
      }
      const { data: blob } = await this.db.storage.from(FILES_BUCKET).download(String(row.storage_path));
      if (!blob) continue;
      await fs.mkdir(path.dirname(local), { recursive: true });
      await fs.writeFile(local, Buffer.from(await blob.arrayBuffer()));
      const stat = await fs.stat(local);
      this.known.set(relative, { id: row.id, size: stat.size, mtimeMs: stat.mtimeMs, ...saved });
    }
  }

  /**
   * Upload new or changed files and record them. Emits a `file` event for
   * each one so the page lists it. Returns the files that changed.
   */
  async sync(run: StoreAgentRun, requested: Set<string> = new Set()): Promise<Array<{ id: string; relative: string }>> {
    const open = new Set([...requested, ...this.pendingOpen]);
    const changed: Array<{ id: string; relative: string }> = [];
    for (const local of await walk(this.cwd)) {
      const relative = path.relative(this.cwd, local).split(path.sep).join("/");
      const stat = await fs.stat(local);
      const prev = this.known.get(relative);
      const unchanged = !!prev && prev.size === stat.size && prev.mtimeMs === stat.mtimeMs;
      // Opened or made for the user: a result from now on.
      const showNow = open.has(relative) || this.pendingShown.has(relative);
      if (unchanged && !showNow) continue;
      if (stat.size > MAX_SYNC_BYTES) continue;
      const shown = showNow || !!prev?.shown;
      const fromStore = this.isFromStore(relative);
      const folder = classifyAgentFile({ path: relative, shown, fromStore, hint: this.folderHints.get(relative) });
      if (unchanged && prev) {
        if (!prev.shown || prev.folder !== folder) {
          const { error } = await this.db.from("store_agent_files").update({ shown: true, folder }).eq("id", prev.id);
          if (error) throw new Error(`Could not record ${relative}: ${error.message}`);
          prev.shown = true;
          prev.folder = folder;
        }
        run.emit({ type: "file", fileId: prev.id, name: relative, kind: kindFor(relative), mime: mimeFor(relative), open: open.has(relative), shown: true, folder });
        this.pendingOpen.delete(relative);
        this.pendingShown.delete(relative);
        continue;
      }
      // A file written again keeps the run it was made in.
      const id = await this.store(relative, await fs.readFile(local), "agent", prev ? undefined : run.id, showNow, { folder, fromStore });
      this.known.set(relative, { id, size: stat.size, mtimeMs: stat.mtimeMs, shown, fromStore, folder });
      run.emit({ type: "file", fileId: id, name: relative, kind: kindFor(relative), mime: mimeFor(relative), open: open.has(relative), shown, folder });
      this.pendingOpen.delete(relative);
      this.pendingShown.delete(relative);
      changed.push({ id, relative });
    }
    return changed;
  }

  /**
   * Upload bytes as a chat file and upsert its row. Returns the file id.
   * `shown` marks it a result; a later upload of the same file never unmarks it.
   */
  async store(relative: string, bytes: Buffer, createdBy: "agent" | "user", runId: string | null | undefined, shown = false, place: { folder?: AgentFolder | null; fromStore?: boolean } = {}): Promise<string> {
    const storagePath = this.storagePath(relative);
    const mime = mimeFor(relative);
    const { error: upErr } = await this.db.storage
      .from(FILES_BUCKET)
      .upload(storagePath, bytes, { upsert: true, contentType: mime, cacheControl: "0" });
    if (upErr) throw new Error(`Could not save ${relative}: ${upErr.message}`);
    const { data, error } = await this.db
      .from("store_agent_files")
      .upsert(
        {
          chat_id: this.chatId,
          workspace_id: this.workspaceId,
          // Left out (undefined) for a file written again: it keeps the run it was made in.
          ...(runId === undefined ? {} : { run_id: runId }),
          name: path.basename(relative).slice(0, 255) || "file",
          kind: createdBy === "user" ? "upload" : kindFor(relative),
          storage_path: storagePath,
          mime,
          size: bytes.length,
          created_by: createdBy,
          // Left out when false, so re-uploading a result keeps it one.
          ...(shown ? { shown: true } : {}),
          ...("folder" in place ? { folder: place.folder } : {}),
          ...(place.fromStore ? { from_store: true } : {}),
        },
        { onConflict: "storage_path" }
      )
      .select("id")
      .single();
    if (error || !data) throw new Error(`Could not record ${relative}: ${error?.message ?? "no row"}`);
    return data.id as string;
  }

  /** Copy an uploaded attachment into the folder so the agent can read it. */
  async placeAttachment(fileId: string, storagePath: string, name: string): Promise<string> {
    const { data, error } = await this.db.storage.from(FILES_BUCKET).download(storagePath);
    if (error || !data) throw new Error(`Could not open the attachment ${name}`);
    const relative = attachmentPath(name);
    const local = path.join(this.cwd, ...relative.split("/"));
    await fs.mkdir(path.dirname(local), { recursive: true });
    const bytes = Buffer.from(await data.arrayBuffer());
    await fs.writeFile(local, bytes);
    const stat = await fs.stat(local);
    // Already stored by the gateway: remember it so sync does not upload it again.
    this.known.set(relative, { id: fileId, size: stat.size, mtimeMs: stat.mtimeMs, shown: true, fromStore: false, folder: null });
    return relative;
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
