import { describe, expect, it } from "vitest";
import { emptyReply, reduceReply } from "./blocks";
import { classifyAgentFile, fileSection } from "./file-kinds";
import {
  afterChip,
  chipBefore,
  encodeMentions,
  fileRef,
  mentionKind,
  mentionLabel,
  mentionSegments,
  mentionedIds,
  plainMentions,
  planRef,
  refId,
  requestLabel,
  splitMentions,
} from "./mentions";

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

  it("shows a short chip in the box and gives the agent the full title and ref", () => {
    const title = "تعديل سعر PulseWatch Series 7 مع عرض خصم";
    const label = mentionLabel(title);
    expect(label.length).toBeLessThanOrEqual(26);
    expect(label.endsWith("…")).toBe(true);
    expect(mentionLabel("report.md")).toBe("report.md");

    const mentions = [
      { label, title, id: planRef(PLAN) },
      { label: "Pulse", title: "Pulse", id: "gid://shopify/Product/1" },
    ];
    const text = `@${label} please, and @Pulse too`;
    expect(encodeMentions(text, mentions)).toBe(`@[${title}](${planRef(PLAN)}) please, and @[Pulse](gid://shopify/Product/1) too`);
    expect(mentionSegments(text, mentions).filter((s) => s.mention).map((s) => s.text)).toEqual([`@${label}`, "@Pulse"]);
    expect(encodeMentions("no chips here", [])).toBe("no chips here");
  });

  it("finds the chip just before the caret, so Backspace removes it whole", () => {
    const mentions = [{ label: "report.md", title: "report.md", id: fileRef(FILE) }];
    const text = "see @report.md now";
    expect(chipBefore(text, 14, mentions)).toEqual({ start: 4, end: 14 });
    expect(chipBefore(text, 15, mentions)).toBeNull();
    expect(chipBefore(text, 10, mentions)).toBeNull();
  });

  it("does not search again after a chosen chip", () => {
    const mentions = [{ label: "report.md", title: "report.md", id: fileRef(FILE) }];
    expect(afterChip("see @report.md please", 21, mentions)).toBe(true);
    expect(afterChip("see @report.md and @pul", 23, mentions)).toBe(false);
    expect(afterChip("see @rep", 8, mentions)).toBe(false);
    expect(afterChip("no mention", 10, mentions)).toBe(false);
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

  it("files by where a file came from, not by its format", () => {
    const place = (path: string, extra: Parameters<typeof classifyAgentFile>[0] extends infer T ? Omit<T, "path"> : never = {}) => classifyAgentFile({ path, ...extra });
    // From the store: whether or not it was opened.
    expect(place("exports/products.csv")).toBe("store_data");
    expect(place("exports/products.csv", { shown: true })).toBe("store_data");
    // Vera's own data: never shown as a result, even when opened.
    expect(place("exports/products.jsonl", { shown: true })).toBe("working");
    expect(place("shopify-results/1.json", { shown: true })).toBe("working");
    expect(place("previews/changes.csv", { shown: true })).toBe("working");
    // Made from the store's data.
    expect(place("reports/products.xlsx", { shown: true, fromStore: true })).toBe("store_data");
    expect(place("outputs/no-images.json", { shown: true, fromStore: true })).toBe("store_data");
    // Her own work, in any format.
    expect(place("reports/seo.md", { shown: true, fromStore: true })).toBe("reports");
    expect(place("outputs/report.html", { shown: true })).toBe("reports");
    expect(place("reports/compare.xlsx", { shown: true })).toBe("reports");
    expect(place("reports/audit.pdf", { shown: true })).toBe("reports");
    expect(place("reports/compare.xlsx", { shown: true, fromStore: true, hint: "reports" })).toBe("reports");
    // Images, and what only she can say is one.
    expect(place("images/banner.png", { shown: true })).toBe("images");
    expect(place("outputs/found.json", { shown: true, hint: "images" })).toBe("images");
    // What was not opened; a hint that does not fit.
    expect(place("outputs/step.csv")).toBe("working");
    expect(place("reports/seo.md", { shown: true, hint: "images" })).toBe("reports");
    expect(place("banner.png", { shown: true, hint: "reports" })).toBe("images");
  });

  it("uses the folder saved with a file", () => {
    expect(fileSection({ ...file("outputs/a.csv"), folder: "store_data" })).toBe("store_data");
    expect(fileSection({ ...file("outputs/a.csv"), folder: "nonsense", shown: false })).toBe("working");
  });

  it("keeps uploads together, and backups and what was made from an upload out of the list", () => {
    expect(fileSection(file("uploads/1f-list.xlsx", { created_by: "user" }))).toBe("uploads");
    expect(fileSection(file("attachments/list.csv", { shown: true }))).toBeNull();
    expect(fileSection(file("attachments/list-images/0.jpg", { shown: true }))).toBeNull();
    expect(fileSection(file("backups/a1.json", { shown: true }))).toBeNull();
    expect(fileSection(file("file-views/reports/p.csv", { shown: true }))).toBeNull();
  });

  it("sorts files from before results were recorded by where they are", () => {
    expect(fileSection(file("reports/seo.md"))).toBe("reports");
    expect(fileSection(file("shopify-results/2026.json"))).toBe("working");
    expect(fileSection(file("exports/products.jsonl"))).toBe("working");
    expect(fileSection(file("exports/products.csv"))).toBe("store_data");
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
