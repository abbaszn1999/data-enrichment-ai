import { describe, expect, it, vi } from "vitest";
import type { ProjectRow } from "@/lib/storage-helpers";
import { updateExistingCatalogSessionRows } from "./session-rows";

const row = (id: string, enrichedData: Record<string, unknown> = {}): ProjectRow => ({
  id,
  rowIndex: Number(id.replace(/\D/g, "")) || 0,
  status: "done",
  originalData: { Title: id },
  enrichedData,
});

function fakeAdmin(existingIds: string[]) {
  const upsert = vi.fn(async () => ({ error: null }));
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async (_col: string, ids: string[]) => ({
            data: ids.filter((id) => existingIds.includes(id)).map((row_id) => ({ row_id })),
            error: null,
          }),
        }),
      }),
      upsert,
    }),
  };
  return { admin: admin as never, upsert };
}

describe("updateExistingCatalogSessionRows (delta autosave)", () => {
  it("writes whole changed rows so a cleared value really goes away", async () => {
    const { admin, upsert } = fakeAdmin(["r1", "r2"]);
    const result = await updateExistingCatalogSessionRows(admin, "s1", [row("r1", { titleTag: "" })]);
    expect(result).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [records] = upsert.mock.calls[0] as unknown as [Array<{ row_id: string; enriched_data: unknown }>];
    expect(records).toHaveLength(1);
    expect(records[0].row_id).toBe("r1");
    expect(records[0].enriched_data).toEqual({ titleTag: "" });
  });

  it("writes nothing and asks for a full save when a row is unknown", async () => {
    const { admin, upsert } = fakeAdmin(["r1"]);
    const result = await updateExistingCatalogSessionRows(admin, "s1", [row("r1"), row("r9")]);
    expect(result).toEqual({ ok: false, missingIds: ["r9"] });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("is a no-op for an empty change", async () => {
    const { admin, upsert } = fakeAdmin([]);
    expect(await updateExistingCatalogSessionRows(admin, "s1", [])).toEqual({ ok: true });
    expect(upsert).not.toHaveBeenCalled();
  });
});
