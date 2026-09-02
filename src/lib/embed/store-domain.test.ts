import { describe, expect, it } from "vitest";
import {
  collectStoreDomains,
  EMBED_DOMAIN_LOOKUP_COLUMNS,
  matchWorkspaceIdByDomain,
  normalizeStoreDomain,
} from "./store-domain";

describe("normalizeStoreDomain", () => {
  it("canonicalises scheme, path, port, case, and a single www prefix", () => {
    expect(normalizeStoreDomain("https://WWW.Shop.com:443/collections/x")).toBe(
      "shop.com"
    );
    expect(normalizeStoreDomain("store.myshopify.com")).toBe(
      "store.myshopify.com"
    );
  });
});

describe("matchWorkspaceIdByDomain", () => {
  const rows = [
    { workspace_id: "tenant-a", normalized_domain: "myshop.com.au" },
    { workspace_id: "tenant-b", normalized_domain: "shop.com" },
  ];

  it("matches only the exact canonical domain", () => {
    expect(matchWorkspaceIdByDomain(rows, "https://www.shop.com")).toBe(
      "tenant-b"
    );
    expect(matchWorkspaceIdByDomain(rows, "myshop.com.au")).toBe("tenant-a");
  });

  it("never resolves shop.com to a workspace that owns myshop.com.au", () => {
    expect(matchWorkspaceIdByDomain(rows, "shop.com")).toBe("tenant-b");
    expect(matchWorkspaceIdByDomain(rows, "shop")).toBeNull();
    expect(matchWorkspaceIdByDomain(rows, "myshop")).toBeNull();
  });
});

describe("collectStoreDomains", () => {
  it("dedupes and drops empty values", () => {
    expect(
      collectStoreDomains([
        "https://www.shop.com",
        "shop.com",
        "",
        "https://shop.myshopify.com",
      ])
    ).toEqual(["shop.com", "shop.myshopify.com"]);
  });
});

describe("embed lookup projection", () => {
  it("never selects integration config (credentials)", () => {
    expect(EMBED_DOMAIN_LOOKUP_COLUMNS).toEqual(["workspace_id"]);
    expect(EMBED_DOMAIN_LOOKUP_COLUMNS).not.toContain("config");
  });
});
