import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  user: { id: "u1" } as { id: string } | null,
  role: "admin" as string | null,
  cmsType: "shopify",
  categories: [] as unknown[],
  updates: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { cms_type: state.cmsType } }) }) }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          state.updates.push(values);
          if (typeof values.cms_type === "string") state.cmsType = values.cms_type;
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/workspace-context", () => ({
  getWorkspaceContext: async () => ({ membershipRole: state.role }),
}));
vi.mock("@/lib/storage-helpers-server", () => ({
  loadCategoriesJsonServer: async () => state.categories,
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://test/api/workspaces/cms-type", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never
  );

describe("workspace platform lock", () => {
  beforeEach(() => {
    state.user = { id: "u1" };
    state.role = "admin";
    state.cmsType = "shopify";
    state.categories = [];
    state.updates = [];
  });

  it("switches the platform while the Categories tab is empty", async () => {
    const res = await post({ workspaceId: "w1", cmsType: "woocommerce" });
    expect(res.status).toBe(200);
    expect(state.cmsType).toBe("woocommerce");
  });

  it("refuses to switch once any category exists", async () => {
    state.categories = [{ id: "1", name: "Sale" }];
    const res = await post({ workspaceId: "w1", cmsType: "woocommerce" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("CATEGORIES_EXIST");
    expect(state.cmsType).toBe("shopify");
    expect(state.updates).toHaveLength(0);
  });

  it("allows re-selecting the current platform even with categories", async () => {
    state.categories = [{ id: "1", name: "Sale" }];
    const res = await post({ workspaceId: "w1", cmsType: "shopify" });
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(0);
  });

  it("only admins can switch", async () => {
    state.role = "editor";
    const res = await post({ workspaceId: "w1", cmsType: "woocommerce" });
    expect(res.status).toBe(403);
    expect(state.cmsType).toBe("shopify");
  });

  it("rejects platforms that are not available yet and anonymous callers", async () => {
    expect((await post({ workspaceId: "w1", cmsType: "magento" })).status).toBe(400);
    state.user = null;
    expect((await post({ workspaceId: "w1", cmsType: "woocommerce" })).status).toBe(401);
  });

  it("reports the platform and category count to any member", async () => {
    state.role = "viewer";
    state.categories = [{ id: "1" }, { id: "2" }];
    const res = await GET(new Request("http://test/api/workspaces/cms-type?workspaceId=w1") as never);
    expect(await res.json()).toEqual({ cmsType: "shopify", categoryCount: 2 });
  });
});
