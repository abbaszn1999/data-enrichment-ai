/**
 * fetch for the Supabase client that rides out short network drops.
 *
 * A dropped connection surfaces as `TypeError: fetch failed` before any
 * response arrives; one blip used to fail a file upload or a save outright.
 * Only those network failures are retried (with backoff), never an HTTP
 * error answer: a 4xx/5xx reached the server and is returned as is.
 */
const RETRY_DELAYS_MS = [400, 1200, 3000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "AbortError") return false;
  return error instanceof TypeError || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|socket/i.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`);
}

export function createResilientFetch(
  base: typeof fetch = fetch,
  log: (message: string) => void = () => {}
): typeof fetch {
  return async (input, init) => {
    // A streamed body cannot be sent twice; buffer it so a retry resends the same bytes.
    let body = init?.body;
    if (body instanceof ReadableStream) body = await new Response(body).arrayBuffer();
    const request = { ...init, body } as RequestInit;
    for (let attempt = 0; ; attempt++) {
      try {
        return await base(input, request);
      } catch (error) {
        if (init?.signal?.aborted || !isNetworkFailure(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        log(
          `network error on ${new URL(url).pathname.split("/").slice(0, 5).join("/")} (${cause?.code ?? cause?.message ?? "no cause"}), ` +
            `retry ${attempt + 1}/${RETRY_DELAYS_MS.length}`
        );
        await sleep(RETRY_DELAYS_MS[attempt]!);
      }
    }
  };
}
