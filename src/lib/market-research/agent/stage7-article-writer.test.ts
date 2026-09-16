import { afterEach, describe, expect, it, vi } from "vitest";
import {
  articleFromOpenAiResponse,
  buildArticleResponsesPayload,
  ensureTermInAltText,
  ensureTermInSeoDescription,
  ensureTermInSeoTitle,
  startArticleWrite,
  stripUnauthorizedLinks,
} from "./stage7-article-writer";

describe("ensureTermInSeoTitle", () => {
  it("is a no-op when the term is already present", () => {
    const title = "Best Ceramic Coffee Mugs for Every Morning";
    expect(ensureTermInSeoTitle(title, "ceramic coffee mugs")).toBe(title);
  });

  it("is case-insensitive when checking for the term", () => {
    const title = "Best CERAMIC COFFEE MUGS for Every Morning";
    expect(ensureTermInSeoTitle(title, "ceramic coffee mugs")).toBe(title);
  });

  it("rebuilds as term-led when the term is missing", () => {
    const result = ensureTermInSeoTitle("A Great Morning Routine", "ceramic coffee mugs");
    expect(result.toLowerCase()).toContain("ceramic coffee mugs");
    expect(result.toLowerCase().indexOf("ceramic coffee mugs")).toBe(0);
  });

  it("respects the max length cap", () => {
    const longTitle = "A".repeat(80);
    const result = ensureTermInSeoTitle(longTitle, "ceramic coffee mugs", 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it("still clamps a too-long title even when the term is present", () => {
    const longTitle = `ceramic coffee mugs ${"x".repeat(80)}`;
    const result = ensureTermInSeoTitle(longTitle, "ceramic coffee mugs", 60);
    expect(result.length).toBeLessThanOrEqual(60);
  });
});

describe("ensureTermInSeoDescription", () => {
  it("is a no-op when the term is already present", () => {
    const description =
      "Shop our ceramic coffee mugs collection for durable, dishwasher-safe designs.";
    expect(ensureTermInSeoDescription(description, "ceramic coffee mugs")).toBe(
      description
    );
  });

  it("blends the term in when missing", () => {
    const result = ensureTermInSeoDescription(
      "Durable, dishwasher-safe designs for every kitchen.",
      "ceramic coffee mugs"
    );
    expect(result.toLowerCase()).toContain("ceramic coffee mugs");
  });

  it("respects the max length cap", () => {
    const longDescription = "A".repeat(200);
    const result = ensureTermInSeoDescription(
      longDescription,
      "ceramic coffee mugs",
      160
    );
    expect(result.length).toBeLessThanOrEqual(160);
  });
});

describe("ensureTermInAltText", () => {
  it("is a no-op when an image already mentions the term", () => {
    const images = [
      { url: "https://example.com/a.jpg", alt: "A set of ceramic coffee mugs" },
      { url: "https://example.com/b.jpg", alt: "A kitchen counter" },
    ];
    expect(ensureTermInAltText(images, "ceramic coffee mugs")).toEqual(images);
  });

  it("extends the first image's alt when no image mentions the term", () => {
    const images = [
      { url: "https://example.com/a.jpg", alt: "A kitchen counter" },
      { url: "https://example.com/b.jpg", alt: "A cozy breakfast nook" },
    ];
    const result = ensureTermInAltText(images, "ceramic coffee mugs");
    expect(result[0].alt.toLowerCase()).toContain("ceramic coffee mugs");
    expect(result[1]).toEqual(images[1]);
  });

  it("is a no-op on an empty image list", () => {
    expect(ensureTermInAltText([], "ceramic coffee mugs")).toEqual([]);
  });
});

describe("stripUnauthorizedLinks", () => {
  it("keeps both a collection href and a product href", () => {
    const html =
      '<p>Browse our <a href="/collections/mugs">mug collection</a> or grab the ' +
      '<a href="/products/blue-mug">Blue Ceramic Mug</a> directly.</p>';
    const allowed = ["/collections/mugs", "/products/blue-mug"];
    expect(stripUnauthorizedLinks(html, allowed)).toBe(html);
  });

  it("strips an invented link but keeps its anchor text", () => {
    const html =
      '<p>Check out <a href="https://example.com/random">this other site</a> too.</p>';
    const result = stripUnauthorizedLinks(html, ["/collections/mugs"]);
    expect(result).toBe("<p>Check out this other site too.</p>");
  });

  it("strips only the unauthorized link among several", () => {
    const html =
      '<a href="/collections/mugs">Mugs</a> and <a href="https://evil.com">bad</a> and ' +
      '<a href="/products/blue-mug">Blue Mug</a>';
    const result = stripUnauthorizedLinks(html, [
      "/collections/mugs",
      "/products/blue-mug",
    ]);
    expect(result).toBe(
      '<a href="/collections/mugs">Mugs</a> and bad and <a href="/products/blue-mug">Blue Mug</a>'
    );
  });
});

const sampleInput = {
  articleId: "art-1",
  title: "How to choose ceramic coffee mugs",
  keyword: "ceramic coffee mugs",
  type: "guide" as const,
  linksOut: [],
};

describe("buildArticleResponsesPayload", () => {
  it("backgrounds the write and stores the response for later retrieve", () => {
    const payload = buildArticleResponsesPayload(sampleInput, { background: true });
    expect(payload.background).toBe(true);
    expect(payload.store).toBe(true);
    expect(payload.metadata).toEqual({
      articleId: "art-1",
      source: "growth-engine-stage7",
    });
  });

  it("omits background when the caller wants a blocking write", () => {
    const payload = buildArticleResponsesPayload(sampleInput);
    expect(payload.background).toBeUndefined();
  });
});

describe("startArticleWrite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns the OpenAI response id without waiting for completion", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "resp_123", status: "queued" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const started = await startArticleWrite(sampleInput);
    expect(started.responseId).toBe("resp_123");
    expect(started.response.status).toBe("queued");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      background?: boolean;
    };
    expect(body.background).toBe(true);
  });
});

describe("articleFromOpenAiResponse", () => {
  it("parses a completed Responses payload into an article", () => {
    const result = articleFromOpenAiResponse(sampleInput, {
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                seoTitle: "Ceramic coffee mugs for daily use",
                seoDescription:
                  "A practical look at ceramic coffee mugs, from size and glaze to what actually lasts in a real kitchen.",
                blogTitle: "none",
                bodyHtml:
                  "<p>Ceramic coffee mugs hold heat without tasting like the mug. Pick a weight you can lift one-handed.</p>",
                images: [],
                featuredImage: { url: "", alt: "" },
              }),
            },
          ],
        },
      ],
    });
    expect(result.bodyHtml).toContain("Ceramic coffee mugs");
    expect(result.seoTitle.toLowerCase()).toContain("ceramic coffee mugs");
    expect(result.blogTitle).toBe("none");
  });
});
