import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * The agent chooses which URLs our server opens, so every hop (including
 * redirects) must point at the public internet: never localhost, private
 * networks, link-local/metadata addresses, or non-http schemes.
 */

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  if (a === undefined || b === undefined) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === "::" || value === "::1") return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  return /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || value.startsWith("ff");
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Throws UnsafeUrlError unless `raw` is an http(s) URL whose host resolves only to public addresses. */
export async function assertPublicUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https URLs can be opened");
  }
  if (url.username || url.password) throw new UnsafeUrlError("URLs with credentials are not allowed");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UnsafeUrlError("Local hosts are not allowed");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("Private addresses are not allowed");
    return url;
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeUrlError("Host could not be resolved");
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("Host resolves to a private address");
  }
  return url;
}

const DNS_TIMEOUT_MS = 5_000;

async function defaultResolve(host: string): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS);
  });
  try {
    const records = await Promise.race([lookup(host, { all: true, verbatim: true }), timeout]);
    return records.map((record) => record.address);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * fetch() that follows redirects manually so each hop passes assertPublicUrl.
 * Returns the final response and URL.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit & { maxRedirects?: number } = {}
): Promise<{ response: Response; finalUrl: string }> {
  let current = (await assertPublicUrl(raw)).href;
  const maxRedirects = init.maxRedirects ?? 5;
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= maxRedirects) throw new UnsafeUrlError("Too many redirects");
      await response.body?.cancel().catch(() => undefined);
      current = (await assertPublicUrl(new URL(location, current).href)).href;
      continue;
    }
    return { response, finalUrl: current };
  }
}

/**
 * Reads a response body up to `maxBytes`. When the body is larger it returns
 * null, or the first `maxBytes` when `truncate` is set (pages stay useful
 * truncated; images do not).
 */
export async function readCapped(
  response: Response,
  maxBytes: number,
  options: { truncate?: boolean } = {}
): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes && !options.truncate) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      if (!options.truncate) return null;
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
