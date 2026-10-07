import vm from "node:vm";
import { checkFunctionBodySafety } from "./safe-function-body";

/**
 * Runs an AI-generated row filter over all rows inside a fresh V8 context.
 * Rows cross the boundary as a JSON string and results come back as a JSON
 * string, so no host object (and therefore no host `Function`/`process`) is
 * reachable from inside the context. The static guard runs first as well.
 */
export function runRowFilterIsolated(
  filterFnBody: string,
  rows: Record<string, string>[],
  timeoutMs = 2_000
): number[] {
  const problem = checkFunctionBodySafety(filterFnBody);
  if (problem) throw new Error(problem);

  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  context.__rowsJson = JSON.stringify(rows);

  const script = new vm.Script(`
    (function () {
      var rows = JSON.parse(__rowsJson);
      var fn = (function (row) { ${filterFnBody}\n });
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        try { if (fn(rows[i])) out.push(i); } catch (e) {}
      }
      return JSON.stringify(out);
    })()
  `);

  const result = script.runInContext(context, { timeout: timeoutMs });
  const parsed = JSON.parse(String(result));
  return Array.isArray(parsed) ? parsed.filter((n) => Number.isInteger(n)) : [];
}
