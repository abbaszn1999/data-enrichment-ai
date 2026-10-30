import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatFiles } from "../../src/store-agent/files";
import { StoreAgentRun } from "../../src/store-agent/run";

const WS = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

/** A Supabase client that lists the given stored rows and records uploads. */
function fakeDb(rows: Array<{ id: string; storage_path: string; size: number }>) {
  const uploads: string[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: rows, error: null }) }),
      upsert: () => ({ select: () => ({ single: async () => ({ data: { id: "new-id" }, error: null }) }) }),
    }),
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploads.push(key);
          return { error: null };
        },
        download: async () => ({ data: null }),
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, uploads };
}

const run = () =>
  new StoreAgentRun({
    runId: "33333333-3333-4333-8333-333333333333",
    chatId: CHAT,
    workspaceId: WS,
    userId: "44444444-4444-4444-8444-444444444444",
    message: "hi",
    attachments: [],
    model: { id: "m", params: [] },
    mode: "agent",
    autoRun: false,
    autoRunBulk: false,
    billing: { ownerUserId: "44444444-4444-4444-8444-444444444444", remainingCredits: 10 },
  });

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("ChatFiles", () => {
  it("does not re-upload or re-list files saved by an earlier run", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "chat-files-"));
    await mkdir(path.join(dir, "reports"), { recursive: true });
    await writeFile(path.join(dir, "reports", "audit.md"), "# audit");
    await writeFile(path.join(dir, "تقرير.md"), "# تقرير");
    const { db, uploads } = fakeDb([
      { id: "f1", storage_path: `${WS}/${CHAT}/reports/audit.md`, size: 7 },
      { id: "f2", storage_path: `${WS}/${CHAT}/u8.${Buffer.from("تقرير.md").toString("base64url")}`, size: 13 },
    ]);
    const files = new ChatFiles(db, dir, WS, CHAT);
    await files.prepare();

    const r = run();
    const changed = await files.sync(r);
    expect(changed).toEqual([]);
    expect(uploads).toEqual([]);
    expect(r.history.filter((e) => e.type === "file")).toEqual([]);

    // A new file is still picked up.
    await writeFile(path.join(dir, "reports", "new.csv"), "a,b");
    expect((await files.sync(r)).map((f) => f.relative)).toEqual(["reports/new.csv"]);
    expect(uploads).toEqual([`${WS}/${CHAT}/reports/new.csv`]);
  });
});
