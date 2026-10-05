import { describe, expect, it } from "vitest";
import {
  appendStoredPhoto,
  cellIsPrimarilyHttpUrl,
  isGalleryPhotoPath,
  parseRowPictures,
  removeStoredPhoto,
  stripStoredImageRefs,
} from "./image-urls";

const PATH = "ws1/gallery/s1/rows/r1/upload-abc.jpg";

describe("uploaded row photos", () => {
  it("adds a photo next to existing links and reads both back", () => {
    const cell = appendStoredPhoto("https://shop.test/a.jpg", PATH);
    expect(cell).toBe(`https://shop.test/a.jpg\nvz-storage:${PATH}`);
    expect(parseRowPictures(cell)).toEqual({
      urls: ["https://shop.test/a.jpg"],
      storedPaths: [PATH],
    });
  });

  it("starts a new cell with only the photo", () => {
    expect(appendStoredPhoto("", PATH)).toBe(`vz-storage:${PATH}`);
    expect(parseRowPictures(`vz-storage:${PATH}`).urls).toEqual([]);
  });

  it("removes only the chosen photo", () => {
    const cell = appendStoredPhoto(appendStoredPhoto("https://shop.test/a.jpg", PATH), "ws1/gallery/s1/rows/r1/upload-def.png");
    expect(removeStoredPhoto(cell, PATH)).toBe(
      "https://shop.test/a.jpg\nvz-storage:ws1/gallery/s1/rows/r1/upload-def.png"
    );
    expect(stripStoredImageRefs(cell)).toBe("https://shop.test/a.jpg");
  });

  it("treats a cell with links and photos as an image cell", () => {
    expect(cellIsPrimarilyHttpUrl(appendStoredPhoto("https://shop.test/a.jpg", PATH))).toBe(true);
    expect(cellIsPrimarilyHttpUrl(`vz-storage:${PATH}`)).toBe(true);
  });

  it("only allows photos saved for this project", () => {
    expect(isGalleryPhotoPath(PATH, "ws1", "s1")).toBe(true);
    expect(isGalleryPhotoPath(PATH, "ws2", "s1")).toBe(false);
    expect(isGalleryPhotoPath(PATH, "ws1", "s2")).toBe(false);
    expect(isGalleryPhotoPath("ws1/gallery/s1/rows/../../x.jpg", "ws1", "s1")).toBe(false);
  });
});
