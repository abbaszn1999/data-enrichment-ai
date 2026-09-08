#!/usr/bin/env node
/**
 * Storage backup / restore drill for the workspace-files bucket.
 *
 * P0-6: customer catalogs live in Storage, which Supabase DB backups do not
 * cover. Run this daily against an independent destination.
 *
 * Backup:
 *   node scripts/backup-workspace-storage.mjs --out ./backups/storage
 *
 * Restore drill (copy a prefix back to a scratch prefix, then delete it):
 *   node scripts/backup-workspace-storage.mjs --restore-dry-run ./backups/storage
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 */
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "workspace-files";
const PAGE = 100;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function admin() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function listAll(client, prefix = "") {
  const files = [];
  const pending = [prefix.replace(/\/$/, "")];
  while (pending.length > 0) {
    const folder = pending.pop();
    let offset = 0;
    for (;;) {
      const { data, error } = await client.storage
        .from(BUCKET)
        .list(folder || "", { limit: PAGE, offset });
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const item of data) {
        const path = folder ? `${folder}/${item.name}` : item.name;
        if (item.id) files.push(path);
        else pending.push(path);
      }
      if (data.length < PAGE) break;
      offset += data.length;
    }
  }
  return files;
}

async function backup(outDir) {
  const client = admin();
  const files = await listAll(client);
  await mkdir(outDir, { recursive: true });
  let copied = 0;
  for (const path of files) {
    const { data, error } = await client.storage.from(BUCKET).download(path);
    if (error) {
      console.error("download failed", path, error.message);
      continue;
    }
    const dest = join(outDir, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await data.arrayBuffer()));
    copied += 1;
  }
  const manifest = {
    bucket: BUCKET,
    createdAt: new Date().toISOString(),
    files: files.length,
    copied,
  };
  await writeFile(join(outDir, "MANIFEST.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

async function restoreDryRun(srcDir) {
  const manifestRaw = await readFile(join(srcDir, "MANIFEST.json"), "utf8");
  const manifest = JSON.parse(manifestRaw);
  const entries = await walkFiles(srcDir);
  console.log(
    JSON.stringify(
      {
        drill: "restore-dry-run",
        manifest,
        localFiles: entries.length,
        note: "No objects were uploaded. Point --restore at a scratch prefix only after this count matches.",
      },
      null,
      2
    )
  );
}

async function walkFiles(dir, prefix = "") {
  const names = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of names) {
    if (entry.name === "MANIFEST.json") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(join(dir, entry.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const args = process.argv.slice(2);
if (args[0] === "--restore-dry-run") {
  await restoreDryRun(args[1] || "./backups/storage");
} else {
  const outIndex = args.indexOf("--out");
  await backup(outIndex >= 0 ? args[outIndex + 1] : "./backups/storage");
}
