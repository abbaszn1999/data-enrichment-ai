import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileTools, resolveConfined } from "../../src/store-agent/file-tools";

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
