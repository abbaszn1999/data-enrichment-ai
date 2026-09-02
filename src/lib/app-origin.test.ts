import { afterEach, describe, expect, it } from "vitest";
import { faqSnippet, linksSnippet } from "@/lib/customize-widgets";
import {
  CANONICAL_APP_ORIGIN,
  getAppOrigin,
  publicOriginFromRequest,
  snippetOrigin,
} from "./app-origin";

describe("getAppOrigin", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("defaults to the canonical Autommerce Platform origin", () => {
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(getAppOrigin()).toBe(CANONICAL_APP_ORIGIN);
  });

  it("prefers NEXT_PUBLIC_APP_ORIGIN and strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_ORIGIN = "https://platform.autommerce.com/";
    expect(getAppOrigin()).toBe("https://platform.autommerce.com");
  });
});

describe("publicOriginFromRequest", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("does not send production auth redirects to Render's bind address", () => {
    const request = new Request("http://localhost:10000/auth/callback/google?code=abc");
    expect(publicOriginFromRequest(request)).toBe(CANONICAL_APP_ORIGIN);
  });

  it("prefers the public forwarded host over localhost", () => {
    const request = new Request("http://localhost:10000/auth/callback/google", {
      headers: {
        "x-forwarded-host": "platform.autommerce.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(publicOriginFromRequest(request)).toBe("https://platform.autommerce.com");
  });
});

describe("snippetOrigin", () => {
  it("does not embed a localhost origin into a merchant snippet", () => {
    expect(snippetOrigin("http://localhost:4000")).toBe(CANONICAL_APP_ORIGIN);
  });
});

describe("widget snippets", () => {
  it("never hardcode the retired Render origin", () => {
    expect(faqSnippet()).not.toContain("data-enrichment-ai.onrender.com");
    expect(linksSnippet()).not.toContain("data-enrichment-ai.onrender.com");
    expect(faqSnippet()).toContain(`${CANONICAL_APP_ORIGIN}/widget.js`);
  });
});
