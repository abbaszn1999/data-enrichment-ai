import { describe, expect, it } from "vitest";
import { isOpenAiInputImageDownloadError } from "./openai";

describe("isOpenAiInputImageDownloadError", () => {
  it("matches OpenAI dead input_image downloads", () => {
    expect(
      isOpenAiInputImageDownloadError(
        "Error while downloading file. Upstream status code: 404."
      )
    ).toBe(true);
    expect(
      isOpenAiInputImageDownloadError(
        "Error while downloading file. Upstream status code: 403."
      )
    ).toBe(true);
    expect(isOpenAiInputImageDownloadError("invalid_image_url")).toBe(true);
  });

  it("does not match unrelated failures", () => {
    expect(isOpenAiInputImageDownloadError("OpenAI enrich failed (429)")).toBe(
      false
    );
    expect(
      isOpenAiInputImageDownloadError("OpenAI enrich ended with status incomplete")
    ).toBe(false);
    expect(isOpenAiInputImageDownloadError("Row not found")).toBe(false);
  });
});
