import { describe, expect, it } from "vitest";
import { WR_MAX_CHAT_ATTACHMENTS } from "./types";
import {
  isWrChatImageFile,
  resolveWrEditInstruction,
  takeWrChatImages,
  WR_CHAT_IMAGE_ONLY_INSTRUCTION,
  wrChatImageFilename,
  wrChatImageFilesFromClipboard,
  wrChatImageFilesFromList,
  wrEditWantsLogoFromAttachments,
} from "./wr-chat-images";
import { isWrChatAttachmentPath } from "./storage";

function png(name = "logo.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

describe("isWrChatImageFile", () => {
  it("accepts common raster types", () => {
    expect(isWrChatImageFile(png())).toBe(true);
    expect(isWrChatImageFile(new File([new Uint8Array([1])], "x.jpg", { type: "image/jpeg" }))).toBe(true);
    expect(isWrChatImageFile(new File([new Uint8Array([1])], "x.webp", { type: "image/webp" }))).toBe(true);
  });

  it("rejects SVG even when the mime claims it is an image", () => {
    expect(isWrChatImageFile(new File(["<svg/>"], "icon.svg", { type: "image/svg+xml" }))).toBe(false);
  });
});

describe("wrChatImageFilesFromList", () => {
  it("drops non-images", () => {
    const files = wrChatImageFilesFromList([png(), new File(["hi"], "note.txt", { type: "text/plain" })]);
    expect(files.map((f) => f.name)).toEqual(["logo.png"]);
  });
});

describe("wrChatImageFilesFromClipboard", () => {
  it("reads files off the clipboard FileList", () => {
    const file = png("pasted.png");
    const data = {
      files: [file],
      items: { length: 0 },
      getData: () => "",
    } as unknown as DataTransfer;
    expect(wrChatImageFilesFromClipboard(data).map((f) => f.name)).toEqual(["pasted.png"]);
  });

  it("falls back to clipboard items when FileList is empty", () => {
    const file = png("from-item.png");
    const data = {
      files: [],
      items: {
        length: 1,
        0: { kind: "file", type: "image/png", getAsFile: () => file },
      },
      getData: () => "",
    } as unknown as DataTransfer;
    expect(wrChatImageFilesFromClipboard(data).map((f) => f.name)).toEqual(["from-item.png"]);
  });
});

describe("wrChatImageFilename", () => {
  it("keeps a real filename and names a nameless paste", () => {
    expect(wrChatImageFilename(png("Brand Logo.PNG"))).toBe("Brand Logo.PNG");
    expect(wrChatImageFilename(new File([new Uint8Array([1])], "blob", { type: "image/png" }))).toBe("pasted-image.png");
  });
});

describe("takeWrChatImages", () => {
  it("caps at WR_MAX_CHAT_ATTACHMENTS", () => {
    const files = Array.from({ length: WR_MAX_CHAT_ATTACHMENTS + 1 }, (_, i) => png(`n${i}.png`));
    const { accepted, rejectedReason } = takeWrChatImages(files, 0);
    expect(accepted).toHaveLength(WR_MAX_CHAT_ATTACHMENTS);
    expect(rejectedReason).toMatch(/up to 4/);
  });

  it("rejects an oversized file", () => {
    const big = png();
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    const { accepted, rejectedReason } = takeWrChatImages([big], 0);
    expect(accepted).toHaveLength(0);
    expect(rejectedReason).toMatch(/8MB/);
  });
});

describe("wrEditWantsLogoFromAttachments", () => {
  it("treats explicit logo / شعار language as a logo swap", () => {
    expect(wrEditWantsLogoFromAttachments("use this as the logo", 1)).toBe(true);
    expect(wrEditWantsLogoFromAttachments("استخدم هذا الشعار", 1)).toBe(true);
  });

  it("does not swap the logo for a palette / color extract", () => {
    expect(wrEditWantsLogoFromAttachments("extract these colors and use them", 1)).toBe(false);
    expect(wrEditWantsLogoFromAttachments("استخرج الألوان", 1)).toBe(false);
  });

  it("treats a single 'use this' image as a logo unless it is a palette", () => {
    expect(wrEditWantsLogoFromAttachments("use this", 1)).toBe(true);
    expect(wrEditWantsLogoFromAttachments("استخدمه", 1)).toBe(true);
    expect(wrEditWantsLogoFromAttachments("use this", 2)).toBe(false);
  });
});

describe("resolveWrEditInstruction", () => {
  it("keeps typed text and fills in an image-only send", () => {
    expect(resolveWrEditInstruction("  make it green  ", 0)).toBe("make it green");
    expect(resolveWrEditInstruction("   ", 1)).toBe(WR_CHAT_IMAGE_ONLY_INSTRUCTION);
    expect(resolveWrEditInstruction("", 0)).toBe("");
  });
});

describe("isWrChatAttachmentPath", () => {
  const ws = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const project = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("accepts a file in this project's chat folder", () => {
    expect(isWrChatAttachmentPath(ws, project, `${ws}/website-restructure/${project}/chat/img1.png`)).toBe(true);
  });

  it("rejects screenshots, other projects, and path traversal", () => {
    expect(isWrChatAttachmentPath(ws, project, `${ws}/website-restructure/${project}/images/img1.png`)).toBe(false);
    expect(
      isWrChatAttachmentPath(ws, project, `${ws}/website-restructure/cccccccc-cccc-cccc-cccc-cccccccccccc/chat/x.png`)
    ).toBe(false);
    expect(isWrChatAttachmentPath(ws, project, `${ws}/website-restructure/${project}/chat/../logo.png`)).toBe(false);
  });
});
