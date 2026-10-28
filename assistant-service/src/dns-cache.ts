import dns, { type LookupAddress } from "node:dns";
import { Agent, setGlobalDispatcher } from "undici";

/**
 * DNS for outgoing fetches, remembered and reused.
 *
 * Every new connection resolves the host again, and a resolver that fails
 * now and then (`getaddrinfo ENOTFOUND`) fails the request with it — which is
 * what broke saves on flaky networks. Answers are kept for five minutes, and
 * when a fresh lookup fails the last good answer is used instead.
 */

const FRESH_MS = 5 * 60 * 1000;
type Entry = { addresses: LookupAddress[]; at: number };
const cache = new Map<string, Entry>();

type LookupOptions = { family?: number | string; all?: boolean; hints?: number };
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function answer(entry: Entry, options: LookupOptions, callback: LookupCallback) {
  const wanted = options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
  const list = wanted ? entry.addresses.filter((a) => a.family === wanted) : entry.addresses;
  if (!list.length) return false;
  if (options.all) callback(null, list);
  else callback(null, list[0]!.address, list[0]!.family);
  return true;
}

export function cachedLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  const hit = cache.get(hostname);
  if (hit && Date.now() - hit.at < FRESH_MS && answer(hit, options, callback)) return;
  dns.lookup(hostname, { all: true, hints: options.hints }, (error, addresses) => {
    if (!error && addresses.length) {
      const entry = { addresses, at: Date.now() };
      cache.set(hostname, entry);
      if (answer(entry, options, callback)) return;
    }
    // The resolver failed: fall back to the last good answer, however old.
    if (hit && answer(hit, options, callback)) return;
    callback(error ?? Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), "", 0);
  });
}

/** Route every fetch in this process through the cached resolver. */
export function installDnsCache(): void {
  setGlobalDispatcher(new Agent({ connect: { lookup: cachedLookup as never }, keepAliveTimeout: 30_000 }));
}
