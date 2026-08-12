import { describe, expect, it } from "vitest";

import { buildWooImagesPayload } from "./payload-builders";

/**
 * WooCommerce deletes any image missing from the `images` array, so these tests
 * guard the one behaviour that silently destroys customer data: touching the
 * featured image must never drop the gallery.
 */
const row = {
  featured_image: "https://shop/main.jpg",
  featured_image_id: "10",
  featured_image_alt_text: "Main shot",
  gallery_images: "https://shop/g1.jpg | https://shop/g2.jpg",
  gallery_media: [
    { id: "11", src: "https://shop/g1.jpg" },
    { id: "12", src: "https://shop/g2.jpg" },
  ],
};

const including = (...columns: string[]) => (column: string) =>
  columns.includes(column);

describe("buildWooImagesPayload", () => {
  it("stays out of the payload when no image column changed", () => {
    expect(buildWooImagesPayload(row, including("title", "price"))).toBeNull();
  });

  it("keeps the existing gallery when only the featured image changed", () => {
    const images = buildWooImagesPayload(row, including("featured_image"));
    expect(images).toEqual([
      { id: 10, alt: "Main shot" },
      { id: 11 },
      { id: 12 },
    ]);
  });

  it("uploads a newly found featured image by src, gallery still by id", () => {
    const images = buildWooImagesPayload(
      { ...row, featured_image: "https://found/new.jpg", featured_image_id: "" },
      including("featured_image")
    );
    expect(images).toEqual([
      { src: "https://found/new.jpg", alt: "Main shot" },
      { id: 11 },
      { id: 12 },
    ]);
  });

  it("appends new gallery URLs as src and re-sends known ones as id", () => {
    const images = buildWooImagesPayload(
      {
        ...row,
        gallery_images:
          "https://shop/g1.jpg | https://shop/g2.jpg | https://found/g3.jpg",
      },
      including("gallery_images")
    );
    expect(images).toEqual([
      { id: 10, alt: "Main shot" },
      { id: 11 },
      { id: 12 },
      { src: "https://found/g3.jpg" },
    ]);
  });

  it("never repeats the featured image inside the gallery", () => {
    const images = buildWooImagesPayload(
      { ...row, gallery_images: "https://shop/MAIN.jpg | https://shop/g1.jpg" },
      including("gallery_images")
    );
    expect(images).toEqual([{ id: 10, alt: "Main shot" }, { id: 11 }]);
  });

  it("skips the payload rather than emptying a product's media", () => {
    const images = buildWooImagesPayload(
      { featured_image: "", gallery_images: "", gallery_media: [] },
      including("featured_image", "gallery_images")
    );
    expect(images).toBeNull();
  });
});
