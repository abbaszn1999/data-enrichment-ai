import { describe, expect, it } from "vitest";
import { isBlockedHostname, isPrivateAddress, isPublicHttpUrl } from "./public-host";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true)
  );
  it.each(["8.8.8.8", "172.32.0.1", "104.18.0.1", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false)
  );
});

describe("isBlockedHostname", () => {
  it("blocks local names and private literals", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("api.internal")).toBe(true);
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("192.168.0.5")).toBe(true);
    expect(isBlockedHostname("cdn.shopify.com")).toBe(false);
  });
});

describe("isPublicHttpUrl", () => {
  it("rejects non-http schemes, credentials and private hosts without a network lookup", async () => {
    expect(await isPublicHttpUrl(new URL("file:///etc/passwd"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://user:pw@example.com/a.jpg"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://127.0.0.1:3000/a.jpg"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://localhost/a.jpg"))).toBe(false);
    expect(await isPublicHttpUrl(new URL("http://93.184.216.34/a.jpg"))).toBe(true);
  });
});
