import { describe, expect, it } from "vitest";
import { scrubSentryEvent, scrubValue } from "./scrub";

describe("scrubValue", () => {
  it("redacts credential keys and Shopify admin tokens", () => {
    const scrubbed = scrubValue({
      config: { admin_api_token: "shpat_abc123" },
      note: "token shpat_abc123 leaked",
    }) as Record<string, unknown>;
    expect(scrubbed.config).toBe("[redacted]");
    expect(String(scrubbed.note)).toContain("[redacted]");
    expect(String(scrubbed.note)).not.toContain("shpat_");
  });
});

describe("scrubSentryEvent", () => {
  it("walks extra payloads", () => {
    const event = scrubSentryEvent({
      extra: { application_password: "xxxx xxxx" },
    });
    expect((event.extra as Record<string, unknown>).application_password).toBe(
      "[redacted]"
    );
  });
});
