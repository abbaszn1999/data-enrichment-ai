import { describe, expect, it } from "vitest";
import { emptyReply, reduceReply } from "./blocks";
import { fileSection } from "./file-kinds";
import { fileRef, mentionKind, mentionedIds, plainMentions, planRef, refId, requestLabel, splitMentions } from "./mentions";

const FILE = "11111111-2222-4333-8444-555555555555";
const PLAN = "66666666-7777-4888-9999-000000000000";

describe("mentions", () => {
  it("reads store records, chat files and plans", () => {
    const text = `Compare @[Galaxy Pulse](gid://shopify/Product/94) with @[report.md](${fileRef(FILE)}) and follow @[Pricing](${planRef(PLAN)})`;
    const parts = splitMentions(text).filter((p) => p.kind === "mention");
    expect(parts.map((p) => (p.kind === "mention" ? [p.title, mentionKind(p.id)] : null))).toEqual([
      ["Galaxy Pulse", "store"],
      ["report.md", "file"],
      ["Pricing", "plan"],
    ]);
    expect(mentionedIds(text)).toEqual({ files: [FILE], plans: [PLAN] });
    expect(refId(fileRef(FILE))).toBe(FILE);
    expect(plainMentions(text)).toBe("Compare @Galaxy Pulse with @report.md and follow @Pricing");
  });

  it("ignores lookalikes and counts each file once", () => {
    expect(mentionedIds(`@[x](file://not-an-id) @[a](${fileRef(FILE)}) @[b](${fileRef(FILE)})`)).toEqual({ files: [FILE], plans: [] });
    expect(splitMentions("email me @ home")).toEqual([{ kind: "text", text: "email me @ home" }]);
  });

  it("says in one short line what a file came from", () => {
    expect(requestLabel(`Open @[kaystore.xlsx](${fileRef(FILE)})\n  with   pictures`)).toBe("Open @kaystore.xlsx with pictures");
    expect(requestLabel("x".repeat(200)).length).toBe(80);
  });
});

describe("panel folders", () => {
  const file = (path: string, extra: Partial<{ created_by: string; shown: boolean }> = {}) => ({
    path,
    name: path.split("/").pop()!,
    created_by: "agent",
    ...extra,
  });

  it("files each result by what it is, and the rest as working files", () => {
    expect(fileSection(file("reports/seo.md", { shown: true }))).toBe("reports");
    expect(fileSection(file("outputs/report.html", { shown: true }))).toBe("reports");
    expect(fileSection(file("exports/products.csv", { shown: true }))).toBe("tables");
    expect(fileSection(file("outputs/gallery.json", { shown: true }))).toBe("tables");
    expect(fileSection(file("reports/products.xlsx", { shown: true }))).toBe("excel");
    expect(fileSection(file("images/banner.png", { shown: true }))).toBe("images");
    expect(fileSection(file("exports/products.jsonl", { shown: false }))).toBe("working");
    expect(fileSection(file("exports/products.csv", { shown: false }))).toBe("working");
  });

  it("keeps uploads together, and backups and what was made from an upload out of the list", () => {
    expect(fileSection(file("uploads/1f-list.xlsx", { created_by: "user" }))).toBe("uploads");
    expect(fileSection(file("attachments/list.csv", { shown: true }))).toBeNull();
    expect(fileSection(file("attachments/list-images/0.jpg", { shown: true }))).toBeNull();
    expect(fileSection(file("backups/a1.json", { shown: true }))).toBeNull();
  });

  it("sorts files from before results were recorded by where they are", () => {
    expect(fileSection(file("reports/seo.md"))).toBe("reports");
    expect(fileSection(file("shopify-results/2026.json"))).toBe("working");
    expect(fileSection(file("exports/products.jsonl"))).toBe("working");
    expect(fileSection(file("previews/changes.csv"))).toBe("working");
  });
});

describe("file blocks under a reply", () => {
  it("turns a working file into a result when the agent opens it", () => {
    let state = reduceReply(emptyReply(), { type: "file", fileId: "f1", name: "exports/p.csv", kind: "csv", mime: "text/csv", open: false, shown: false, seq: 1 });
    expect(state.blocks[0]).toMatchObject({ shown: false });
    state = reduceReply(state, { type: "file", fileId: "f1", name: "exports/p.csv", kind: "csv", mime: "text/csv", open: true, shown: true, seq: 2 });
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ shown: true });
    state = reduceReply(state, { type: "file", fileId: "f1", name: "exports/p.csv", kind: "csv", mime: "text/csv", open: false, shown: false, seq: 3 });
    expect(state.blocks[0]).toMatchObject({ shown: true });
  });
});
