import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  signedPaths: [] as string[],
};

vi.mock("@/lib/visualizer/auth", () => ({
  requireVisualizerAuth: async () => ({
    ok: true,
    headers: {},
    admin: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "s1" } }),
            }),
          }),
        }),
      }),
    },
  }),
}));
vi.mock("@/lib/visualizer/storage-admin", () => ({
  createVisualizerSignedUrlsAdmin: async (paths: string[]) => {
    state.signedPaths = paths;
    return Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`]));
  },
}));

import { POST } from "./route";

const call = (body: unknown) =>
  POST(
    new NextRequest("http://test/api/visualizer/sessions/s1/signed-urls", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId: "s1" }) }
  );

describe("visualizer signed urls", () => {
  beforeEach(() => {
    state.signedPaths = [];
  });

  it("signs only paths that belong to this project", async () => {
    const own = "w1/description-visualizer/s1/rows/r1/image-1-abc.jpg";
    const res = await call({
      workspaceId: "w1",
      paths: [own, "other/description-visualizer/s1/rows/r1/image-1-abc.jpg", "../secret"],
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.signedPaths).toEqual([own]);
    expect(body.signedUrls[own]).toBe(`https://signed/${own}`);
  });
});
