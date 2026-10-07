"use client";

import { checkFunctionBodySafety } from "./safe-function-body";

/**
 * Runs an AI-generated row transform inside a sandboxed iframe
 * (`sandbox="allow-scripts"` without `allow-same-origin`). The frame has an
 * opaque origin: no access to this page, its DOM, storage or auth cookies.
 * Data crosses the boundary only via structured-clone postMessage.
 */

const FRAME_SRC = `<!doctype html><meta charset="utf-8"><script>
window.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type !== "run") return;
  var out;
  try {
    var fn = new Function("row", d.body);
    out = d.rows.map(function (r) {
      try {
        var res = fn(Object.assign({}, r));
        if (!res || typeof res !== "object") return {};
        var clean = {};
        Object.keys(res).forEach(function (k) { clean[k] = String(res[k]); });
        return clean;
      } catch (err) { return {}; }
    });
    parent.postMessage({ type: "result", id: d.id, rows: out }, "*");
  } catch (err) {
    parent.postMessage({ type: "error", id: d.id, message: String(err && err.message || err) }, "*");
  }
});
parent.postMessage({ type: "ready" }, "*");
</script>`;

let framePromise: Promise<HTMLIFrameElement> | null = null;

function getFrame(): Promise<HTMLIFrameElement> {
  if (framePromise) return framePromise;
  framePromise = new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.display = "none";
    const onReady = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.data?.type !== "ready") return;
      window.removeEventListener("message", onReady);
      resolve(iframe);
    };
    window.addEventListener("message", onReady);
    iframe.srcdoc = FRAME_SRC;
    document.body.appendChild(iframe);
    setTimeout(() => {
      window.removeEventListener("message", onReady);
      reject(new Error("Sandbox failed to start"));
      framePromise = null;
    }, 10_000);
  });
  return framePromise;
}

let nextId = 1;

export async function runRowFunctionSandboxed(
  body: string,
  rows: Record<string, string>[],
  timeoutMs = 15_000
): Promise<Record<string, string>[]> {
  const problem = checkFunctionBodySafety(body);
  if (problem) throw new Error(problem);
  if (rows.length === 0) return [];

  const iframe = await getFrame();
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      // A runaway function blocks the frame; replace it next time.
      iframe.remove();
      framePromise = null;
      reject(new Error("Function took too long to run"));
    }, timeoutMs);

    function onMessage(e: MessageEvent) {
      if (e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || d.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (d.type === "result" && Array.isArray(d.rows)) {
        resolve(
          d.rows.map((r: unknown) =>
            r && typeof r === "object" ? (r as Record<string, string>) : {}
          )
        );
      } else {
        reject(new Error(d.message || "Function failed"));
      }
    }

    window.addEventListener("message", onMessage);
    iframe.contentWindow?.postMessage({ type: "run", id, body, rows }, "*");
  });
}
