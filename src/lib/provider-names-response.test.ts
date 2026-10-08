import { describe, expect, it } from "vitest";
import { installProviderNameScrubber, scrubErrorFields } from "./provider-names-response";

describe("scrubErrorFields", () => {
  it("hides provider names in error fields only", () => {
    const body = { error: "OpenAI request failed", name: "Gemini sign necklace" };
    expect(scrubErrorFields(body)).toEqual({ error: "AI request failed", name: "Gemini sign necklace" });
    expect(scrubErrorFields({ error: { message: "[GoogleGenerativeAI Error]: gemini-3.6-flash quota" } })).toEqual({
      error: { message: "AI quota" },
    });
  });

  it("returns the same object when nothing changes", () => {
    const body = { error: "Not found" };
    expect(scrubErrorFields(body)).toBe(body);
    const list = [{ error: "OpenAI" }];
    expect(scrubErrorFields(list)).toBe(list);
  });
});

describe("installProviderNameScrubber", () => {
  it("cleans bodies sent through Response.json", async () => {
    installProviderNameScrubber();
    installProviderNameScrubber();
    const res = Response.json({ error: "Serper failed", ok: false }, { status: 502 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "image search failed", ok: false });
  });
});
