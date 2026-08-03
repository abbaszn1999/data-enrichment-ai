import { describe, expect, it } from "vitest";
import { imageRefsMatch, normalizeImageRef } from "@/lib/gallery/image-refs";

describe("imageRefsMatch", () => {
  it("matches identical refs", () => {
    expect(
      imageRefsMatch(
        "workspace/a/gallery/main.png",
        "workspace/a/gallery/main.png"
      )
    ).toBe(true);
  });

  it("matches &amp; encoding", () => {
    expect(
      imageRefsMatch(
        "https://cdn.example/img?a=1&amp;b=2",
        "https://cdn.example/img?a=1&b=2"
      )
    ).toBe(true);
  });

  it("matches storage key suffix inside longer URL", () => {
    expect(
      imageRefsMatch(
        "https://signed.example/object/workspace/a/gallery/main-abc123.png?token=1",
        "workspace/a/gallery/main-abc123.png"
      )
    ).toBe(true);
  });

  it("does not match unrelated paths", () => {
    expect(
      imageRefsMatch(
        "workspace/a/gallery/main-a.png",
        "workspace/a/gallery/main-b.png"
      )
    ).toBe(false);
  });

  it("normalizes amp entities", () => {
    expect(normalizeImageRef("a&amp;b")).toBe("a&b");
  });
});
