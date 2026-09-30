/**
 * Live probe: does SearchApi bill a Google AI Mode call that answers HTTP 200
 * but carries an `error`, or returns an empty answer? Compares the account's
 * remaining credits (GET /api/v1/me) before and after each call.
 * Never prints the API key. Run: npx tsx scripts/searchapi-billing-probe.ts
 */
import { readFileSync } from "node:fs";

function loadKey(): string {
  const env = readFileSync(".env", "utf8");
  const match = env.match(/^SEARCHAPI_API_KEY=(.+)$/m);
  if (!match) throw new Error("SEARCHAPI_API_KEY missing from .env");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

async function account(key: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://www.searchapi.io/api/v1/me", {
    headers: { Authorization: `Bearer ${key}` },
  });
  return (await res.json()) as Record<string, unknown>;
}

function usageOf(me: Record<string, unknown>): string {
  const account = (me.account ?? me) as Record<string, unknown>;
  const pick = ["monthly_allowance", "remaining_credits", "current_month_usage", "credits_used"];
  return pick.filter((k) => k in account).map((k) => `${k}=${String(account[k])}`).join(" ") || "no usage fields";
}

async function call(key: string, q: string, extra: Record<string, string> = {}) {
  const url = new URL("https://www.searchapi.io/api/v1/search");
  url.searchParams.set("engine", "google_ai_mode");
  url.searchParams.set("q", q);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  const status = (body.search_metadata as Record<string, unknown> | undefined)?.status;
  return { http: res.status, status, hasError: "error" in body, error: body.error, blocks: Array.isArray(body.text_blocks) ? body.text_blocks.length : 0 };
}

async function main() {
  const key = loadKey();
  const cases: Array<{ q: string; extra?: Record<string, string> }> = [
    { q: "haier hrf-570wh", extra: { location: "Nowhere Land 12345" } },
    { q: "haier hrf-570wh", extra: { gl: "zz", hl: "zz" } },
  ];
  for (const { q, extra } of cases) {
    const before = usageOf(await account(key));
    const result = await call(key, q, extra);
    await new Promise((r) => setTimeout(r, 3000));
    const after = usageOf(await account(key));
    console.log(JSON.stringify({ q, extra, result, before, after }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.replace(/Bearer\s+\S+/g, "Bearer ***") : "failed");
  process.exit(1);
});
