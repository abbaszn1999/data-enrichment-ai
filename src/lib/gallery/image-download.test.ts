import { describe, expect, it } from "vitest";
import {
  failureFromStatus,
  imageDownloadFailureMessage,
  isSlowOrigin,
  lighterImageUrl,
} from "@/lib/gallery/image-download";

describe("lighterImageUrl", () => {
  it("lowers a large size parameter", () => {
    expect(
      lighterImageUrl("https://www.rei.com/media/fd51bcb4-0eb1-41b9-95ef-a0ccf046859e?size=2000")
    ).toBe("https://www.rei.com/media/fd51bcb4-0eb1-41b9-95ef-a0ccf046859e?size=1200");
  });

  it("keeps other parameters and handles width", () => {
    expect(lighterImageUrl("https://cdn.example.com/p.jpg?v=3&width=2400")).toBe(
      "https://cdn.example.com/p.jpg?v=3&width=1200"
    );
  });

  it("has nothing lighter for small, missing or non-numeric sizes", () => {
    expect(lighterImageUrl("https://x.com/a.jpg?size=800")).toBeNull();
    expect(lighterImageUrl("https://x.com/a.jpg")).toBeNull();
    expect(lighterImageUrl("https://x.com/a.jpg?size=large")).toBeNull();
    expect(lighterImageUrl("not a url")).toBeNull();
  });
});

describe("failure classification", () => {
  it("maps HTTP statuses", () => {
    expect(failureFromStatus(403)).toBe("refused");
    expect(failureFromStatus(404)).toBe("missing");
    expect(failureFromStatus(503)).toBe("server");
    expect(failureFromStatus(418)).toBe("other");
  });

  it("only treats slow or unreachable origins as worth a lighter retry", () => {
    expect(isSlowOrigin("timeout")).toBe(true);
    expect(isSlowOrigin("server")).toBe(true);
    expect(isSlowOrigin("refused")).toBe(false);
    expect(isSlowOrigin("missing")).toBe(false);
    expect(isSlowOrigin(undefined)).toBe(false);
  });
});

describe("imageDownloadFailureMessage", () => {
  const base = "Could not download the image from the selected image column";

  it("names the site and the next step", () => {
    const message = imageDownloadFailureMessage("https://www.rei.com/media/x?size=2000", "timeout");
    expect(message.startsWith(base)).toBe(true);
    expect(message).toContain("rei.com took too long");
    expect(message).toContain("upload the picture into the sheet");
  });

  it("falls back to the plain message when the reason is unknown", () => {
    expect(imageDownloadFailureMessage(undefined, undefined)).toBe(base);
  });
});
