import { promises as fs } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { SDKCustomTool } from "@cursor/sdk";
import { resolveConfined } from "./file-tools";

/**
 * run_script: plain JavaScript over files in the chat folder, for exact work
 * on big data (count, filter, join, reshape thousands of rows) that a model
 * should not do by reading.
 *
 * Isolation does not rest on reading the code: the script runs in a fresh V8
 * context that holds no host object at all (inputs enter as one string and
 * are parsed inside, the helpers are defined inside), with code generation
 * from strings off, in a worker thread with a heap limit, under a time limit.
 * Nothing in that context leads back to Node, so ordinary data code
 * (`counts[key]++`, a `location` field, Arabic text escapes) is allowed. The
 * guard below only turns away code that plainly reaches for Node or for
 * asynchronous work the sandbox cannot run.
 */

const MAX_CODE_CHARS = 60_000;
const REFUSED = /(?<![\w$.])(?:process|require|module|exports|import|Buffer|child_process|WebAssembly|Atomics|SharedArrayBuffer|async|await)(?![\w$])/;
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g;

export function checkScriptBody(body: string): string | null {
  if (!body.trim()) return "The code is empty.";
  if (body.length > MAX_CODE_CHARS) return `The code is longer than ${MAX_CODE_CHARS.toLocaleString("en")} characters; split the work into steps.`;
  const hit = body.replace(STRING_LITERAL, '""').match(REFUSED);
  if (hit) return `\`${hit[0]}\` is not available: scripts are plain synchronous JavaScript over the inputs, with no Node APIs.`;
  return null;
}

const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/** CSV helpers available to scripts as `csv.parse(text)` and `csv.stringify(rows)`. */
const CSV_HELPERS = `
var csv = {
  parse: function (text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\\n" || ch === "\\r") { if (ch === "\\r" && text[i + 1] === "\\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
    if (!rows.length) return [];
    var head = rows[0];
    return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (h, j) { o[h] = r[j] === undefined ? "" : r[j]; }); return o; });
  },
  stringify: function (objects) {
    var cols = [];
    objects.forEach(function (o) { Object.keys(o).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
    var cell = function (v) { var s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.map(cell).join(",")].concat(objects.map(function (o) { return cols.map(function (c) { return cell(o[c]); }).join(","); })).join("\\n");
  },
  jsonl: function (text) { return text.split("\\n").filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); }); }
};`;

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
try {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  context.__in = workerData.inputs;
  const source = "(function(){" + workerData.helpers + "\\nvar inputs = JSON.parse(__in);\\nvar out = (function (inputs, csv) {\\n" + workerData.body + "\\n})(inputs, csv);\\nreturn JSON.stringify(out === undefined ? null : out);})()";
  const result = new vm.Script(source, { filename: "script.js" }).runInContext(context, { timeout: workerData.timeout });
  parentPort.postMessage({ ok: true, result: String(result) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error && error.message ? error.message : error) });
}`;

export type ScriptResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Run a script body over named text inputs in an isolated worker. */
export function runIsolatedScript(body: string, inputs: Record<string, string>, timeoutMs = TIMEOUT_MS): Promise<ScriptResult> {
  const problem = checkScriptBody(body);
  if (problem) return Promise.resolve({ ok: false, error: problem });
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { body, inputs: JSON.stringify(inputs), helpers: CSV_HELPERS, timeout: timeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
      env: {},
    });
    const hardStop = setTimeout(() => {
      void worker.terminate();
      resolve({ ok: false, error: `The script ran longer than ${Math.round(timeoutMs / 1000)}s and was stopped.` });
    }, timeoutMs + 5_000);
    worker.once("message", (message: { ok: boolean; result?: string; error?: string }) => {
      clearTimeout(hardStop);
      void worker.terminate();
      if (!message.ok) return resolve({ ok: false, error: message.error ?? "The script failed." });
      try {
        resolve({ ok: true, value: JSON.parse(message.result ?? "null") });
      } catch {
        resolve({ ok: false, error: "The script returned something that is not JSON." });
      }
    });
    worker.once("error", (error: unknown) => {
      clearTimeout(hardStop);
      const message = error instanceof Error ? error.message : String(error);
      resolve({ ok: false, error: /heap|memory/i.test(message) ? "The script ran out of memory." : message });
    });
  });
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const failure = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: true as const });

export function createScriptTool(root: string, onWrite: (relative: string) => void): Record<string, SDKCustomTool> {
  return {
    run_script: {
      description:
        "Run JavaScript over files in your folder for exact data work: count, filter, group, join, compare and reshape thousands of rows. " +
        "Pass the file paths as `inputs`; your code is the BODY of `function (inputs, csv)`: `inputs` maps each path to its text, " +
        "`csv.parse(text)` gives an array of objects, `csv.stringify(objects)` gives CSV text, `csv.jsonl(text)` parses JSONL. " +
        "Return a JSON value: `{ result, files: { \"name.csv\": text } }` — `result` comes back to you, `files` are saved under outputs/. " +
        "Plain synchronous JavaScript (ES2023): objects, arrays, Map/Set, regex, JSON, Math, Intl and dynamic keys like `counts[key]++` all work. " +
        "No network, no Node APIs, no async. 20s and 256 MB limits. Write one complete script per step rather than many small ones.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Function body. Example: `var rows = csv.parse(inputs['exports/products.csv']); return { result: rows.length };`" },
          inputs: { type: "array", items: { type: "string" }, description: "Paths in your folder to read." },
        },
        required: ["code"],
      },
      execute: async (args) => {
        const code = String(args.code ?? "");
        const paths = Array.isArray(args.inputs) ? args.inputs.map(String).slice(0, 20) : [];
        const inputs: Record<string, string> = {};
        let total = 0;
        try {
          for (const p of paths) {
            const file = await resolveConfined(root, p, { mustExist: true });
            const content = await fs.readFile(file, "utf8");
            total += Buffer.byteLength(content);
            if (total > MAX_INPUT_BYTES) return failure("The inputs are larger than 40 MB together.");
            inputs[p] = content;
          }
        } catch (error) {
          return failure((error as Error).message);
        }
        const outcome = await runIsolatedScript(code, inputs);
        if (!outcome.ok) return failure(`Script error: ${outcome.error}`);
        const value = (outcome.value ?? null) as { result?: unknown; files?: Record<string, unknown> } | null;
        const written: string[] = [];
        if (value && typeof value === "object" && value.files && typeof value.files === "object") {
          let bytes = 0;
          for (const [name, content] of Object.entries(value.files).slice(0, 20)) {
            const safe = name.replace(/[^\w.\-؀-ۿ]+/g, "_").slice(0, 100);
            if (!safe) continue;
            const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
            bytes += Buffer.byteLength(body);
            if (bytes > MAX_OUTPUT_BYTES) return failure("The script's output files are larger than 20 MB.");
            const target = await resolveConfined(root, `outputs/${safe}`, { mustExist: false });
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, body, "utf8");
            written.push(`outputs/${safe}`);
            onWrite(`outputs/${safe}`);
          }
        }
        const result = value && typeof value === "object" && "result" in value ? value.result : value;
        const json = JSON.stringify(result ?? null, null, 1);
        return text(
          JSON.stringify({ files: written }) +
            "\n" +
            (json.length > 30_000 ? `${json.slice(0, 30_000)}… (truncated; write large results to a file)` : json)
        );
      },
    },
  };
}
