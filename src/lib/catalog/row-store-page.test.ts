import { describe, expect, it, vi } from "vitest";
import { ROW_STORE_READ_PAGE, loadAllOrderedRows } from "./row-store-page";

describe("loadAllOrderedRows", () => {
  it("pages past the PostgREST 1000-row default", async () => {
    const fetchPage = vi.fn(async (from: number, to: number) => {
      expect(to - from + 1).toBe(ROW_STORE_READ_PAGE);
      if (from === 0) return Array.from({ length: ROW_STORE_READ_PAGE }, (_, i) => i);
      if (from === ROW_STORE_READ_PAGE) {
        return Array.from({ length: 38 }, (_, i) => from + i);
      }
      return [];
    });

    const rows = await loadAllOrderedRows({ fetchPage });
    expect(rows).toHaveLength(1038);
    expect(rows[0]).toBe(0);
    expect(rows[1037]).toBe(1037);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops on a short first page", async () => {
    const fetchPage = vi.fn(async () => [1, 2, 3]);
    await expect(loadAllOrderedRows({ fetchPage })).resolves.toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
