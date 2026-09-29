import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json-extract";

describe("extractJsonObject", () => {
  it("parses a pure JSON answer", () => {
    expect(extractJsonObject('{"result":"MATCHES_FOUND","matches":[]}')).toEqual({
      result: "MATCHES_FOUND",
      matches: [],
    });
  });

  it("ignores trailing commentary the model appended after the JSON", () => {
    const text =
      '{"result":"MATCHES_FOUND","matches":[{"url":"https://x.test/p"}]}\n\nIf you want to search a specific size, let me know.';
    expect(extractJsonObject(text)).toEqual({
      result: "MATCHES_FOUND",
      matches: [{ url: "https://x.test/p" }],
    });
  });

  it("ignores leading commentary before the JSON", () => {
    const text = 'Here is what I found:\n{"result":"NO_EXACT_MATCH","matches":[]}';
    expect(extractJsonObject(text)).toEqual({ result: "NO_EXACT_MATCH", matches: [] });
  });

  it("strips markdown code fences", () => {
    const text = '```json\n{"result":"NO_EXACT_MATCH","matches":[]}\n```';
    expect(extractJsonObject(text)).toEqual({ result: "NO_EXACT_MATCH", matches: [] });
  });

  it("handles braces inside quoted string values without losing its place", () => {
    const text = '{"result":"MATCHES_FOUND","matches":[{"evidence":"Case { A } shown"}]}';
    expect(extractJsonObject(text)).toEqual({
      result: "MATCHES_FOUND",
      matches: [{ evidence: "Case { A } shown" }],
    });
  });

  it("returns null for text with no JSON object", () => {
    expect(extractJsonObject("STATUS: NOT_FOUND")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(extractJsonObject("")).toBeNull();
  });

  it("returns null when the braces never close", () => {
    expect(extractJsonObject('{"result":"MATCHES_FOUND"')).toBeNull();
  });

  it("returns null for a JSON array (not an object)", () => {
    expect(extractJsonObject("[1,2,3]")).toBeNull();
  });
});
