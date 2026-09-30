/**
 * Live check of OpenAI Responses background mode with the hosted web_search
 * tool: (1) a short run completes and its usage is readable by GET, and
 * (2) a long run cancelled after a few seconds still exposes the usage it
 * consumed. Never prints the API key.
 *
 * Finding: (1) works. (2) does NOT: a response cancelled mid-run reports
 * usage 0 on GET, so background mode cannot recover the cost of a timed-out
 * call and is not used by the app.
 * Run: node --env-file=.env scripts/openai-background-lab.mts
 */
const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error("OPENAI_API_KEY missing");
const URL_BASE = "https://api.openai.com/v1/responses";
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${URL_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

const summarize = (json: any) => ({
  id: json?.id,
  status: json?.status,
  usage: json?.usage
    ? { in: json.usage.input_tokens, out: json.usage.output_tokens, reasoning: json.usage.output_tokens_details?.reasoning_tokens }
    : null,
  webSearchCalls: Array.isArray(json?.output) ? json.output.filter((o: any) => o.type === "web_search_call").length : 0,
  error: json?.error?.message ?? null,
});

async function run(label: string, input: string, cancelAfterMs: number | null) {
  const request = {
    model: "gpt-6-sol",
    input,
    tools: [{ type: "web_search", search_context_size: "low" }],
    reasoning: { effort: "low" },
    background: true,
  };
  const created = await api("POST", "", request);
  console.log(label, "created", created.status, summarize(created.json));
  if (created.status >= 400 || !created.json?.id) return;
  const id = created.json.id as string;
  const started = Date.now();
  let current = created.json;
  while (["queued", "in_progress"].includes(current.status)) {
    if (cancelAfterMs !== null && Date.now() - started >= cancelAfterMs) {
      const cancelled = await api("POST", `/${id}/cancel`, {});
      console.log(label, "cancel", cancelled.status, summarize(cancelled.json));
      const final = await api("GET", `/${id}`);
      console.log(label, "after cancel GET", final.status, summarize(final.json));
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
    current = (await api("GET", `/${id}`)).json ?? current;
    console.log(label, `t+${Math.round((Date.now() - started) / 1000)}s`, current.status, "web_search_calls:", summarize(current).webSearchCalls);
  }
  console.log(label, "finished", summarize(current), `${Math.round((Date.now() - started) / 1000)}s`);
}

await run("short", "Reply with the single word OK. Do not search.", null);
await run(
  "long-cancelled",
  "Search the web for the official product page of the Haier HRF-570WH refrigerator and at least four different shops that sell it, open each page and list the price and image URL of each.",
  Number(process.env.CANCEL_AFTER_MS ?? 45_000)
);
