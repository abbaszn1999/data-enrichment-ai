import { describe, expect, it } from "vitest";
import { CANONICAL_APP_ORIGIN } from "@/lib/app-origin";
import { resolveWidgetApiOrigin } from "./widget-origin";

describe("resolveWidgetApiOrigin", () => {
  it("derives the API origin from the executing script src", () => {
    expect(
      resolveWidgetApiOrigin({
        scriptSrc: "https://platform.autommerce.com/widget.js",
      })
    ).toBe("https://platform.autommerce.com");
  });

  it("never falls back to the retired Render hostname", () => {
    const origin = resolveWidgetApiOrigin({ scriptSrc: null, hostname: "shop.com" });
    expect(origin).toBe(CANONICAL_APP_ORIGIN);
    expect(origin).not.toContain("data-enrichment-ai.onrender.com");
  });
});
