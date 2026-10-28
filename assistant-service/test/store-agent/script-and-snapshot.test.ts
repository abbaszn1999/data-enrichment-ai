import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createScriptTool, runIsolatedScript } from "../../src/store-agent/script-tool";
import { bulkMutationErrors, exportToCsv, parseBulkLines } from "../../src/store-agent/shopify/bulk";
import { collectTargets, flattenFields, isUndoable, previewCsv, previewFromSnapshots, restoreOperations, type Snapshot } from "../../src/store-agent/shopify/snapshot";

describe("run_script sandbox", () => {
  it("computes over inputs with the csv helpers", async () => {
    const out = await runIsolatedScript(
      "var rows = csv.parse(inputs['p.csv']); var drafts = rows.filter(function (r) { return r.status === 'DRAFT'; }); return { result: drafts.length, files: { 'drafts.csv': csv.stringify(drafts) } };",
      { "p.csv": 'title,status\n"A, big one",DRAFT\nB,ACTIVE\nC,DRAFT\n' }
    );
    expect(out).toEqual({ ok: true, value: { result: 2, files: { "drafts.csv": 'title,status\n"A, big one",DRAFT\nC,DRAFT' } } });
  });

  it("turns away code that reaches for Node", async () => {
    for (const body of ["return process.env", "return require('fs')", "return import('fs')", "return Buffer.from('x')", "return (async function () { return 1 })()"]) {
      const out = await runIsolatedScript(body, {});
      expect(out.ok, body).toBe(false);
    }
  });

  it("finds no way out of the context when escapes are actually run", async () => {
    // These pass the guard on purpose: the context itself must hold.
    for (const body of [
      "return this.constructor.constructor('return process')()",
      "return ({}).constructor.constructor('return globalThis.process')()",
      "return ({})['const' + 'ructor']['const' + 'ructor']('return 1')()",
      "return eval('1')",
      "return new Function('return 1')()",
      "try { null.x } catch (e) { return e.constructor.constructor('return process')() }",
      "function f() { f() } try { f() } catch (e) { return e.constructor.constructor('return process')() }",
      "return Object.getPrototypeOf(inputs).constructor.constructor('return process')()",
    ]) {
      const out = await runIsolatedScript(body, {});
      expect(out.ok, body).toBe(false);
    }
    const scope = await runIsolatedScript(
      "var g = globalThis; return [typeof g.process, typeof g.require, typeof g.Buffer, typeof g.fetch, typeof g.setTimeout, Object.getOwnPropertyNames(g).filter(function (k) { return k[0] !== k[0].toUpperCase() && k !== 'console'; })]",
      {}
    );
    expect(scope).toEqual({ ok: true, value: ["undefined", "undefined", "undefined", "undefined", "undefined", expect.not.arrayContaining(["process", "require"])] });
  });

  it("allows ordinary data code", async () => {
    const out = await runIsolatedScript(
      "var rows = csv.jsonl(inputs['inv.jsonl']); var byLocation = {}; rows.forEach(function (r) { var key = r.location + ' / ' + r.status; byLocation[key] = (byLocation[key] || 0) + 1; }); return { result: { byLocation: byLocation, label: '\\u0645\\u062e\\u0632\\u0648\\u0646', mapped: [...new Map([['a', 1]]).keys()] } };",
      { "inv.jsonl": '{"location":"Shop","status":"ok"}\n{"location":"Shop","status":"ok"}\n{"location":"Toronto","status":"empty"}\n' }
    );
    expect(out).toEqual({ ok: true, value: { result: { byLocation: { "Shop / ok": 2, "Toronto / empty": 1 }, label: "مخزون", mapped: ["a"] } } });
  });

  it("runs in a context without host objects", async () => {
    // Names the guard allows still find nothing from the host in the fresh context.
    // (V8's own inspector-only `console` exists in every context; Node's globals do not.)
    const out = await runIsolatedScript("return [typeof structuredClone, typeof URL, typeof TextEncoder, typeof inputs, typeof JSON]", {});
    expect(out).toEqual({ ok: true, value: ["undefined", "undefined", "undefined", "object", "object"] });
  });

  it("stops endless loops and reports script errors", async () => {
    const loop = await runIsolatedScript("while (true) {}", {}, 500);
    expect(loop.ok).toBe(false);
    const thrown = await runIsolatedScript("throw new Error('bad input')", {});
    expect(thrown).toEqual({ ok: false, error: "bad input" });
  }, 15_000);

  it("reads inputs from the folder and writes outputs into it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sa-script-"));
    await mkdir(path.join(root, "exports"), { recursive: true });
    await writeFile(path.join(root, "exports", "p.csv"), "id,price\n1,10\n2,30\n");
    const written: string[] = [];
    const tool = createScriptTool(root, (r) => written.push(r)).run_script!;
    const res = (await tool.execute(
      { code: "var r = csv.parse(inputs['exports/p.csv']); var t = 0; r.forEach(function (x) { t += Number(x.price); }); return { result: t, files: { 'sum.json': { total: t } } };", inputs: ["exports/p.csv"] } as never,
      {} as never
    )) as { content: Array<{ text: string }> };
    expect(res.content[0]!.text).toContain("40");
    expect(written).toEqual(["outputs/sum.json"]);
    expect(JSON.parse(await readFile(path.join(root, "outputs", "sum.json"), "utf8"))).toEqual({ total: 40 });
    const outside = (await tool.execute({ code: "return 1", inputs: ["../secret"] } as never, {} as never)) as { isError?: boolean };
    expect(outside.isError).toBe(true);
  });
});

describe("snapshots, preview and undo", () => {
  const records: Snapshot[] = [
    {
      id: "gid://shopify/Product/1",
      type: "Product",
      label: "Phone",
      before: { title: "Old", "seo.title": "Old SEO", tags: ["a"] },
      after: { title: "New", "seo.title": "New SEO", tags: ["a", "b"], media: [{ originalSource: "x" }] },
      unsupported: ["media"],
    },
    { id: "gid://shopify/ProductVariant/9", type: "ProductVariant", label: "Phone / Black", productId: "gid://shopify/Product/1", before: { price: "10.00" }, after: { price: "12.00" }, unsupported: [] },
    { id: "gid://shopify/Collection/5", type: "Collection", label: "Phones", before: { descriptionHtml: "<p>x</p>" }, after: { descriptionHtml: "<p>y</p>" }, unsupported: [] },
  ];

  it("finds the records a change touches and what it sets", () => {
    const targets = collectTargets({
      product: { id: "gid://shopify/Product/1", title: "New", seo: { title: "S" } },
      variants: [{ id: "gid://shopify/ProductVariant/9", price: "12.00" }],
    });
    expect([...targets.keys()]).toEqual(["gid://shopify/Product/1", "gid://shopify/ProductVariant/9"]);
    expect(flattenFields(targets.get("gid://shopify/Product/1")!)).toEqual({ title: "New", "seo.title": "S" });
  });

  it("builds the card preview and the full CSV", () => {
    const preview = previewFromSnapshots(records, 2)!;
    expect(preview.more).toBe(1);
    expect(preview.items[0]!.changes.find((c) => c.field === "title")).toEqual({ field: "title", before: "Old", after: "New" });
    expect(previewCsv(records).split("\n")[0]).toBe("record,id,field,before,after");
    expect(previewCsv(records)).toContain("media");
  });

  it("restores products, variants (grouped by product) and collections", () => {
    expect(isUndoable(records)).toBe(true);
    const ops = restoreOperations({ version: 1, createdAt: "", operations: ["productUpdate"], records });
    expect(ops).toHaveLength(3);
    expect(ops[0]!.variables).toEqual({ product: { id: "gid://shopify/Product/1", title: "Old", seo: { title: "Old SEO" }, tags: ["a"] } });
    expect(ops[1]!.variables).toEqual({ input: { id: "gid://shopify/Collection/5", descriptionHtml: "<p>x</p>" } });
    expect(ops[2]!.variables).toEqual({ productId: "gid://shopify/Product/1", variants: [{ id: "gid://shopify/ProductVariant/9", price: "10.00" }] });
    expect(isUndoable([{ ...records[0]!, before: {} }])).toBe(false);
  });
});

describe("bulk results", () => {
  it("flattens an export with child counts", () => {
    const lines = parseBulkLines(
      [
        '{"id":"gid://shopify/Product/1","title":"A","seo":{"title":"S"}}',
        '{"id":"gid://shopify/ProductVariant/11","price":"1","__parentId":"gid://shopify/Product/1"}',
        '{"id":"gid://shopify/ProductVariant/12","price":"2","__parentId":"gid://shopify/Product/1"}',
        '{"id":"gid://shopify/Product/2","title":"B, quoted"}',
      ].join("\n")
    );
    const { csv, rows, columns } = exportToCsv(lines);
    expect(rows).toBe(2);
    expect(columns).toEqual(["id", "title", "seo.title", "ProductVariant count"]);
    expect(csv.split("\n")[2]).toBe('gid://shopify/Product/2,"B, quoted",,');
  });

  it("collects userErrors per input line", () => {
    const errors = bulkMutationErrors(
      parseBulkLines('{"data":{"productUpdate":{"userErrors":[]}},"__lineNumber":0}\n{"data":{"productUpdate":{"userErrors":[{"message":"Title too long"}]}},"__lineNumber":1}')
    );
    expect(errors).toEqual([{ line: 1, message: "Title too long" }]);
  });
});
