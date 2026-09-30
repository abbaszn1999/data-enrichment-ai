import { describe, expect, it } from "vitest";
import { AI_MODE_FIXTURES } from "./__fixtures__/ai-mode-answers";
import { extractJsonValues, repairJson } from "./json-extract";
import { harvestLinkCandidates, parseExactLinksAnswer } from "./links-skill";
import { answerTexts } from "./searchapi";

describe("Google AI Mode answer corpus", () => {
  for (const fixture of AI_MODE_FIXTURES) {
    it(`reads: ${fixture.name}`, () => {
      const parsed = parseExactLinksAnswer(fixture.text);
      expect(parsed.readable).toBe(fixture.readable);
      expect(parsed.matches.map((m) => m.url)).toEqual(fixture.urls);
      expect(parsed.result).toBe(fixture.urls.length > 0 ? "MATCHES_FOUND" : "NO_EXACT_MATCH");
    });
  }
});

describe("extractJsonValues", () => {
  it("returns every top-level value in order, skipping prose and fences", () => {
    const values = extractJsonValues('a {"x":1} b ```json\n[{"y":2}]\n``` c {"z":3}');
    expect(values).toEqual([{ x: 1 }, [{ y: 2 }], { z: 3 }]);
  });

  it("finds a valid object inside a broken outer one", () => {
    const values = extractJsonValues('{broken {"ok":true} still broken}');
    expect(values).toContainEqual({ ok: true });
  });

  it("does not stop at braces inside strings", () => {
    expect(extractJsonValues('{"evidence":"Case { A } and ] shown","n":1}')).toEqual([
      { evidence: "Case { A } and ] shown", n: 1 },
    ]);
  });

  it("keeps a curly quote that is real text inside an already valid string", () => {
    expect(extractJsonValues('{"evidence":"5\u201D screen"}')).toEqual([{ evidence: "5\u201D screen" }]);
  });

  it("copes with unbalanced input and huge input without hanging", () => {
    expect(extractJsonValues("{{{{{[[[[")).toEqual([]);
    const big = `${"x".repeat(300_000)} {"a":1}`;
    expect(Array.isArray(extractJsonValues(big))).toBe(true);
  });
});

describe("repairJson", () => {
  it("removes trailing commas and comments outside strings only", () => {
    const repaired = repairJson('{"u":"https://x.test/a,b", // note\n "v":[1,2,],}');
    expect(JSON.parse(repaired)).toEqual({ u: "https://x.test/a,b", v: [1, 2] });
  });
});

describe("answerTexts (SearchApi renderings)", () => {
  it("collects paragraph, list-item and table text and keeps the markdown as a second rendering", () => {
    const texts = answerTexts({
      text_blocks: [
        { type: "paragraph", answer: "Intro" },
        { type: "unordered_list", items: [{ type: "paragraph", answer: "https://a.test/p/1" }] },
        { type: "table", table: [["Shop", "https://b.test/p/2"]] },
        { type: "code_block", code: '{"result":"NO_EXACT_MATCH","matches":[]}' },
      ],
      markdown: "Different markdown rendering",
    });
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Intro");
    expect(texts[0]).toContain("https://a.test/p/1");
    expect(texts[0]).toContain("https://b.test/p/2");
    expect(texts[0]).toContain("NO_EXACT_MATCH");
    expect(texts[1]).toBe("Different markdown rendering");
  });

  it("does not repeat a markdown identical to the blocks, and returns nothing for an empty answer", () => {
    expect(answerTexts({ text_blocks: [{ answer: "same" }], markdown: "same" })).toEqual(["same"]);
    expect(answerTexts({})).toEqual([]);
  });
});

describe("harvestLinkCandidates", () => {
  it("takes https links from the text and the cited pages, without trailing punctuation or repeats", () => {
    const leads = harvestLinkCandidates("See https://a.test/p/1, and (https://b.test/p/2). Also https://a.test/p/1", [
      "https://c.test/p/3",
      "http://insecure.test/p",
    ]);
    expect(leads.map((l) => l.url)).toEqual(["https://a.test/p/1", "https://b.test/p/2", "https://c.test/p/3"]);
    expect(leads.every((l) => l.matchedOn === "unstated")).toBe(true);
  });
});
