import { describe, expect, it } from "vitest";
import {
  mimeTypeFromImageUrl,
  referenceToGeminiImagePart,
} from "@/lib/gallery/agents/ai-shared";

describe("referenceToGeminiImagePart", () => {
  it("uses official Interactions uri shape for public HTTPS URLs", () => {
    expect(
      referenceToGeminiImagePart({
        label: "main",
        uri: "https://example.com/product.jpeg",
        contentType: "image/jpeg",
      })
    ).toEqual({
      type: "image",
      uri: "https://example.com/product.jpeg",
      mime_type: "image/jpeg",
    });
  });

  it("uses official inline data shape when buffer is provided", () => {
    const buffer = Buffer.from("png-bytes");
    expect(
      referenceToGeminiImagePart({
        label: "main",
        buffer,
        contentType: "image/png",
      })
    ).toEqual({
      type: "image",
      data: buffer.toString("base64"),
      mime_type: "image/png",
    });
  });
});

describe("mimeTypeFromImageUrl", () => {
  it("infers mime from extension", () => {
    expect(mimeTypeFromImageUrl("https://cdn.example/a.PNG?x=1")).toBe(
      "image/png"
    );
    expect(mimeTypeFromImageUrl("https://cdn.example/a.webp")).toBe(
      "image/webp"
    );
    expect(mimeTypeFromImageUrl("https://cdn.example/a.jpeg")).toBe(
      "image/jpeg"
    );
  });
});
