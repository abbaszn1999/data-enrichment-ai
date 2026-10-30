import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChatFiles } from "../../src/store-agent/files";
import { mentionContext } from "../../src/store-agent/mentions";
import { StoreAgentRun } from "../../src/store-agent/run";

const WS = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

type Row = { id: string; storage_path: string; size: number; shown?: boolean };

/** A Supabase client that lists the given stored rows and records what is written. */
function fakeDb(rows: Row[]) {
  const uploads: string[] = [];
  const upserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ values: Record<string, unknown>; id: unknown }> = [];
  let next = 0;
  const db = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: rows, error: null }) }),
      upsert: (values: Record<string, unknown>) => {
        upserts.push(values);
        return { select: () => ({ single: async () => ({ data: { id: `new-${++next}` }, error: null }) }) };
      },
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          updates.push({ values, id });
          return { error: null };
        },
      }),
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
  return { db: db as unknown as SupabaseClient, uploads, upserts, updates };
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

  it("marks what it opens or makes for the user as results, and the rest as working files", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "chat-files-"));
    await mkdir(path.join(dir, "exports"), { recursive: true });
    await writeFile(path.join(dir, "exports", "p.jsonl"), "{}");
    await writeFile(path.join(dir, "exports", "p.csv"), "a");
    const { db, upserts, updates } = fakeDb([]);
    const files = new ChatFiles(db, dir, WS, CHAT);
    await files.prepare();
    const r = run();

    await files.sync(r);
    const events = () => r.history.filter((e) => e.type === "file") as Array<{ name: string; shown?: boolean; open: boolean; fileId: string }>;
    expect(events().map((e) => [e.name, e.shown])).toEqual([
      ["exports/p.csv", false],
      ["exports/p.jsonl", false],
    ]);
    expect(upserts.every((u) => !("shown" in u))).toBe(true);

    // Opening the CSV later makes it a result, without uploading it again.
    await files.sync(r, new Set(["exports/p.csv"]));
    expect(updates).toEqual([{ values: { shown: true, folder: "store_data" }, id: events()[0]!.fileId }]);
    expect(events().at(-1)).toMatchObject({ name: "exports/p.csv", shown: true, open: true });

    // Written again later: uploaded again, still the run it was made in.
    expect(upserts[0]).toHaveProperty("run_id");
    await writeFile(path.join(dir, "exports", "p.jsonl"), '{"a":1}');
    await files.sync(r);
    expect(upserts.at(-1)).toMatchObject({ storage_path: `${WS}/${CHAT}/exports/p.jsonl` });
    expect(upserts.at(-1)).not.toHaveProperty("run_id");

    // An Excel file made for the user: a result, not opened.
    await writeFile(path.join(dir, "products.xlsx"), "x");
    files.markShown("products.xlsx");
    await files.sync(r);
    expect(upserts.at(-1)).toMatchObject({ shown: true });
    expect(events().at(-1)).toMatchObject({ name: "products.xlsx", shown: true, open: false });
  });
});

describe("mentioned files and plans", () => {
  it("gives the path of this chat's files, shows mentioned images, and gives a plan's text", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "chat-files-"));
    await mkdir(path.join(dir, "images"), { recursive: true });
    await mkdir(path.join(dir, "attachments"), { recursive: true });
    await writeFile(path.join(dir, "images", "banner.png"), "PNG");
    await writeFile(path.join(dir, "attachments", "kaystore.csv"), "a");
    const IMG = "aaaaaaaa-0000-4000-8000-000000000001";
    const UP = "aaaaaaaa-0000-4000-8000-000000000002";
    const PLAN = "bbbbbbbb-0000-4000-8000-000000000001";
    const asked: Array<{ table: string; chat: unknown; ids: unknown }> = [];
    const table = (name: string, rows: unknown[]) => ({
      select: () => ({
        eq: (_c: string, chat: unknown) => ({
          in: async (_k: string, ids: unknown) => {
            asked.push({ table: name, chat, ids });
            return { data: rows };
          },
        }),
      }),
    });
    const db = {
      from: (name: string) =>
        name === "store_agent_files"
          ? table(name, [
              { id: IMG, name: "banner.png", mime: "image/png", size: 3, storage_path: `${WS}/${CHAT}/images/banner.png`, created_by: "agent" },
              { id: UP, name: "kaystore.xlsx", mime: "application/vnd.ms-excel", size: 9, storage_path: `${WS}/${CHAT}/uploads/1-kaystore.xlsx`, created_by: "user" },
            ])
          : table(name, [{ id: PLAN, title: "Pricing", content: "# Pricing\n- [ ] Set prices", version: 2 }]),
    } as unknown as SupabaseClient;

    const ctx = await mentionContext(db, CHAT, dir, `Use @[banner.png](file://${IMG}), @[kaystore.xlsx](file://${UP}) and @[Pricing](plan://${PLAN})`);
    expect(asked.every((a) => a.chat === CHAT)).toBe(true);
    expect(ctx.images).toEqual([{ data: Buffer.from("PNG").toString("base64"), mimeType: "image/png" }]);
    expect(ctx.notes[0]).toContain('"banner.png": images/banner.png in your folder (the image is attached');
    expect(ctx.notes[0]).toContain('"kaystore.xlsx": uploads/1-kaystore.xlsx in your folder; read it as attachments/kaystore.csv');
    expect(ctx.notes[1]).toContain('the plan "Pricing" (version 2)');
    expect(ctx.notes[1]).toContain("- [ ] Set prices");
    expect(await mentionContext(db, CHAT, dir, "no mentions")).toEqual({ notes: [], images: [] });
  });
});
