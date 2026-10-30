import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFileTools, resolveConfined } from "../../src/store-agent/file-tools";
import { INLINE_RESULT_BYTES, sdkToolOutputDir } from "../../src/store-agent/sdk-output";

type Result = { content: Array<{ text: string }>; isError?: boolean };
const call = async (tools: ReturnType<typeof createFileTools>, name: string, args: Record<string, unknown>) =>
  (await tools[name]!.execute(args as never, { sessionId: "s" } as never)) as Result;

async function setup() {
  const base = await mkdtemp(path.join(os.tmpdir(), "sa-files-"));
  const root = path.join(base, "chat");
  await mkdir(path.join(root, "attachments"), { recursive: true });
  await writeFile(path.join(root, "attachments", "list.csv"), "a,b\n1,2\n");
  await writeFile(path.join(base, "secret.env"), "KEY=1");
  const written: string[] = [];
  return { base, root, written, tools: createFileTools(root, (r) => written.push(r)) };
}

describe("confined file tools", () => {
  it("lists, reads, writes, edits and searches inside the folder", async () => {
    const { root, tools, written } = await setup();
    expect((await call(tools, "list_files", {})).content[0]!.text).toContain("attachments/list.csv");
    expect((await call(tools, "read_file", { path: "attachments/list.csv" })).content[0]!.text).toContain("1,2");
    await call(tools, "write_file", { path: "reports/seo.md", content: "# SEO\nTitle missing\n" });
    expect(written).toEqual(["reports/seo.md"]);
    await call(tools, "edit_file", { path: "reports/seo.md", old_text: "missing", new_text: "fixed" });
    expect((await call(tools, "search_files", { pattern: "fixed" })).content[0]!.text).toContain("reports/seo.md:2:");
    expect(root).toBeTruthy();
  });

  it("refuses absolute paths, traversal and symlinks out of the folder", async () => {
    const { base, root, tools } = await setup();
    expect((await call(tools, "read_file", { path: path.join(base, "secret.env") })).isError).toBe(true);
    expect((await call(tools, "read_file", { path: "../secret.env" })).isError).toBe(true);
    expect((await call(tools, "write_file", { path: "../escape.txt", content: "x" })).isError).toBe(true);
    expect((await call(tools, "read_file", { path: "/proc/self/environ" })).isError).toBe(true);
    expect((await call(tools, "read_file", { path: "C:/Windows/win.ini" })).isError).toBe(true);
    try {
      await symlink(path.join(base, "secret.env"), path.join(root, "link.env"));
    } catch {
      return; // symlinks need extra rights on Windows; the realpath check is covered on Linux
    }
    expect((await call(tools, "read_file", { path: "link.env" })).isError).toBe(true);
  });

  it("refuses to edit when the text is missing or ambiguous", async () => {
    const { tools } = await setup();
    await call(tools, "write_file", { path: "a.md", content: "x x" });
    expect((await call(tools, "edit_file", { path: "a.md", old_text: "y", new_text: "z" })).isError).toBe(true);
    expect((await call(tools, "edit_file", { path: "a.md", old_text: "x", new_text: "z" })).isError).toBe(true);
    expect((await call(tools, "edit_file", { path: "a.md", old_text: "x", new_text: "z", replace_all: true })).isError).toBeUndefined();
  });

  it("allows new nested files inside the folder", async () => {
    const { root } = await setup();
    await expect(resolveConfined(root, "new/deep/file.md", { mustExist: false })).resolves.toContain("file.md");
    await expect(resolveConfined(root, "missing.md", { mustExist: true })).rejects.toThrow(/no file/);
  });
});

describe("results the SDK saved to a file", () => {
  it("keeps read_file and search_files under the SDK's inline limit, in bytes", async () => {
    const { root, tools } = await setup();
    // Arabic is two bytes a character: 400 lines of ~300 characters is far over 40,000 bytes.
    const line = "وصف المنتج ".repeat(28);
    await writeFile(path.join(root, "big.md"), Array.from({ length: 400 }, () => line).join("\n"));
    const read = (await call(tools, "read_file", { path: "big.md" })).content[0]!.text;
    expect(Buffer.byteLength(read)).toBeLessThanOrEqual(INLINE_RESULT_BYTES);
    expect(read).toMatch(/more lines \(offset \d+\)/);
    const found = (await call(tools, "search_files", { pattern: "المنتج" })).content[0]!.text;
    expect(Buffer.byteLength(found)).toBeLessThanOrEqual(INLINE_RESULT_BYTES);
    expect(found).toContain("more matches");
  });

  it("reads this chat's saved results, by path or name, and no other chat's", async () => {
    const { base, root, tools } = await setup();
    const home = path.join(base, "home");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const mine = sdkToolOutputDir(root);
    const other = sdkToolOutputDir(path.join(base, "other-chat"));
    await mkdir(mine, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(path.join(mine, "16b4ae85-4a52-4772-9ccc-ae2fff0aa96c.txt"), "page text");
    await writeFile(path.join(other, "aaaaaaaa-0000-4000-8000-000000000000.txt"), "someone else");

    expect(mine).toContain(path.join(".cursor", "projects"));
    const byPath = await call(tools, "read_file", { path: path.join(mine, "16b4ae85-4a52-4772-9ccc-ae2fff0aa96c.txt") });
    expect(byPath.content[0]!.text).toContain("page text");
    expect((await call(tools, "read_file", { path: "16b4ae85-4a52-4772-9ccc-ae2fff0aa96c.txt" })).content[0]!.text).toContain("page text");
    expect((await call(tools, "read_file", { path: path.join(other, "aaaaaaaa-0000-4000-8000-000000000000.txt") })).isError).toBe(true);
    expect((await call(tools, "read_file", { path: path.join(mine, "..", "..", "x", "agent-tools", "16b4ae85-4a52-4772-9ccc-ae2fff0aa96c.txt") })).isError).toBe(true);
    expect((await call(tools, "read_file", { path: path.join(base, "secret.env") })).isError).toBe(true);
  });
});
