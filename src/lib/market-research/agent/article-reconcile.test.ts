import { describe, expect, it } from "vitest";
import type {
  GeneratedArticle,
  StrategyArticle,
} from "@/components/market-research/workspace-data";
import { reconcileStrategyArticles } from "./article-reconcile";

function row(overrides: Partial<StrategyArticle> = {}): StrategyArticle {
  return {
    id: "art-1",
    title: "How to choose ceramic mugs",
    keyword: "ceramic mugs",
    type: "guide",
    category: "-",
    volume: 100,
    difficulty: 20,
    linksOut: [],
    priority: "high",
    status: "pending",
    ...overrides,
  };
}

const article: GeneratedArticle = {
  articleId: "art-1",
  seoTitle: "Ceramic mugs that last",
  seoDescription: "How to pick a ceramic mug.",
  blogTitle: "Guides",
  bodyHtml: "<p>Body</p>",
  images: [],
};

describe("reconcileStrategyArticles", () => {
  it("marks a generating row ready when the body was saved", () => {
    const next = reconcileStrategyArticles(
      [row({ status: "generating" })],
      { "art-1": article }
    );
    expect(next[0]?.status).toBe("ready");
    expect(next[0]?.category).toBe("Guides");
    expect(next[0]?.error).toBeUndefined();
  });

  it("does not un-sync an article that already reached the store", () => {
    const next = reconcileStrategyArticles(
      [row({ status: "synced", category: "Guides" })],
      { "art-1": article }
    );
    expect(next[0]?.status).toBe("synced");
  });

  it("keeps generating when a job is in flight and no body exists yet", () => {
    const next = reconcileStrategyArticles(
      [row({ status: "pending" })],
      {},
      { "art-1": { status: "in_progress" } }
    );
    expect(next[0]?.status).toBe("generating");
  });

  it("surfaces a failed OpenAI job after refresh", () => {
    const next = reconcileStrategyArticles(
      [row({ status: "generating" })],
      {},
      { "art-1": { status: "failed", error: "safety" } }
    );
    expect(next[0]?.status).toBe("failed");
    expect(next[0]?.error).toBe("safety");
  });
});
