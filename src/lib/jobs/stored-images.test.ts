import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => ({}) }));

const { resolveStoredImageUrls, STORED_IMAGE_LINK_TTL_SEC } = await import("./stored-images");

describe("resolveStoredImageUrls", () => {
  it("returns ordinary links untouched without signing anything", async () => {
    const sign = vi.fn();
    const urls = ["https://cdn.example.com/a.jpg"];
    expect(await resolveStoredImageUrls(urls, sign)).toBe(urls);
    expect(sign).not.toHaveBeenCalled();
  });

  it("swaps sheet pictures for long-lived signed links, keeping order", async () => {
    const sign = vi.fn(async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])));
    const out = await resolveStoredImageUrls(
      ["https://cdn.example.com/a.jpg", "vz-storage:ws/x.png", "vz-storage:ws/x.png", "vz-storage:ws/y.png"],
      sign
    );
    expect(out).toEqual(["https://cdn.example.com/a.jpg", "https://signed/ws/x.png", "https://signed/ws/y.png"]);
    expect(sign).toHaveBeenCalledWith(["ws/x.png", "ws/y.png"], STORED_IMAGE_LINK_TTL_SEC);
  });

  it("drops pictures that cannot be signed instead of failing the row", async () => {
    const out = await resolveStoredImageUrls(["https://cdn.example.com/a.jpg", "vz-storage:gone.png"], async () => {
      throw new Error("storage down");
    });
    expect(out).toEqual(["https://cdn.example.com/a.jpg"]);
  });
});
