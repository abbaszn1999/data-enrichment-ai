import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "./url-safety";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true)
  );
  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false)
  );
});

describe("assertPublicUrl", () => {
  const publicDns = async () => ["93.184.216.34"];

  it("accepts a public https URL", async () => {
    await expect(assertPublicUrl("https://shop.test/p", publicDns)).resolves.toBeInstanceOf(URL);
  });

  it("rejects non-http schemes, credentials and local hosts", async () => {
    await expect(assertPublicUrl("file:///etc/passwd", publicDns)).rejects.toThrow("Only http and https");
    await expect(assertPublicUrl("https://user:pass@shop.test/", publicDns)).rejects.toThrow("credentials");
    await expect(assertPublicUrl("http://localhost:3000/", publicDns)).rejects.toThrow("Local hosts");
    await expect(assertPublicUrl("http://printer.local/", publicDns)).rejects.toThrow("Local hosts");
  });

  it("rejects private IP literals and hosts that resolve to private addresses", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data", publicDns)).rejects.toThrow("Private");
    await expect(assertPublicUrl("https://sneaky.test/", async () => ["10.0.0.5"])).rejects.toThrow("private");
  });
});
