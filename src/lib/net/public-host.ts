import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** True for loopback, private, link-local, CGNAT, multicast and other non-public IP literals. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
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
  if (family === 6) {
    if (ip === "::" || ip === "::1") return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      ip.startsWith("fc") ||
      ip.startsWith("fd") ||
      ip.startsWith("fe8") ||
      ip.startsWith("fe9") ||
      ip.startsWith("fea") ||
      ip.startsWith("feb") ||
      ip.startsWith("ff")
    );
  }
  return false;
}

/** Host names that never resolve to the public internet. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return isPrivateAddress(host);
  return false;
}

/**
 * Whether a URL may be fetched server-side on behalf of a user: http(s) only,
 * no credentials, and the host must not be, or resolve to, a private address.
 */
export async function isPublicHttpUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (isBlockedHostname(url.hostname)) return false;
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0) return true;
  try {
    const addresses = await lookup(url.hostname, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}
