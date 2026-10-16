import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { catalogProjectPath, listAgentProjects } from "./projects";

type Call = { table: string; columns: string; workspaceId?: string; limit?: number };

function fakeSupabase(tables: Record<string, Record<string, unknown>[]>, calls: Call[] = []) {
  return {
    from(table: string) {
      const call: Call = { table, columns: "" };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(_column: string, value: string) {
          call.workspaceId = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          call.limit = n;
          return Promise.resolve({ data: (tables[table] ?? []).slice(0, n), error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: tables[table]?.[0] ?? null, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Project ${id}`,
  status: "completed",
  updated_at: "2026-10-16T10:00:00Z",
  ...extra,
});

describe("listAgentProjects", () => {
  it("opens catalog projects on their current step", () => {
    expect(catalogProjectPath("acme", "p1", "completed")).toBe("/w/acme/catalog-intelligence/p1");
    expect(catalogProjectPath("acme", "p1", "review")).toBe("/w/acme/catalog-intelligence/p1/review");
    expect(catalogProjectPath("acme", "p1", "matching")).toBe("/w/acme/catalog-intelligence/p1/rules");
  });

  it("lists every tool with paths the agent can open, scoped to the workspace", async () => {
    const calls: Call[] = [];
    const supabase = fakeSupabase(
      {
        catalog_sessions: [row("c1", { total_rows: 12, kind: "plp" })],
        gallery_sessions: [row("g1", { total_rows: 3 })],
        visualizer_sessions: [row("v1")],
        image_classification_sessions: [row("i1", { total_images: 40 })],
        wr_projects: [row("w1", { phase: "build" })],
        workspace_integrations: [{ id: "s1", integration_name: "My Shop", provider: "shopify", status: "connected" }],
      },
      calls
    );
    const result = await listAgentProjects(supabase, { workspaceId: "ws1", workspaceSlug: "acme" });

    expect(result.catalog).toEqual({
      projects: [expect.objectContaining({ id: "c1", items: 12, kind: "plp", open: "/w/acme/catalog-intelligence/c1" })],
      more: false,
    });
    expect(result.gallery).toMatchObject({ projects: [{ open: "/w/acme/products-gallery?project=g1" }] });
    expect(result.visualizer).toMatchObject({ projects: [{ open: "/w/acme/products-visualizer?project=v1" }] });
    expect(result.classify).toMatchObject({ projects: [{ items: 40, open: "/w/acme/image-classify/i1" }] });
    expect(result.website).toMatchObject({
      projects: [{ open: "/w/acme/website-restructure", select: "website.project.w1", phase: "build" }],
    });
    expect(result.store).toMatchObject({ projects: [{ name: "My Shop", open: "/w/acme/store-assistant" }] });
    expect(calls.every((call) => call.workspaceId === "ws1")).toBe(true);
    expect(calls.find((call) => call.table === "wr_projects")?.columns).not.toContain("provider");
  });

  it("returns more rows for one tool and flags older ones", async () => {
    const many = Array.from({ length: 45 }, (_, i) => row(`c${i}`));
    const one = await listAgentProjects(fakeSupabase({ catalog_sessions: many }), {
      workspaceId: "ws1",
      workspaceSlug: "acme",
      tool: "catalog",
    });
    expect(Object.keys(one)).toEqual(["catalog"]);
    expect(one.catalog).toMatchObject({ more: true });
    expect((one.catalog as { projects: unknown[] }).projects).toHaveLength(40);

    const all = await listAgentProjects(fakeSupabase({ catalog_sessions: many }), { workspaceId: "ws1", workspaceSlug: "acme" });
    expect((all.catalog as { projects: unknown[] }).projects).toHaveLength(8);
  });
});
