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

  it("reaches nested error fields and leaves content alone", () => {
    const body = {
      session: { error_message: "Serper failed", name: "Gemini shop" },
      rows: [{ id: "a", errorMessage: "gpt-6.1-sol timed out", title: "OpenAI mug" }, { id: "b" }],
      warnings: ["OpenAI slow"],
    };
    const out = scrubErrorFields(body);
    expect(out).toEqual({
      session: { error_message: "image search failed", name: "Gemini shop" },
      rows: [{ id: "a", errorMessage: "the AI agent timed out", title: "OpenAI mug" }, { id: "b" }],
      warnings: ["AI slow"],
    });
    expect(out.rows[1]).toBe(body.rows[1]);
    expect(body.session.error_message).toBe("Serper failed");
  });

  it("returns the same object when nothing changes", () => {
    const body = { error: "Not found", rows: [{ errorMessage: "Row not found" }] };
    expect(scrubErrorFields(body)).toBe(body);
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
