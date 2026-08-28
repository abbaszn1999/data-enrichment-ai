import { describe, expect, it } from "vitest";
import {
  dateWindowSinceIso,
  escapeIlike,
  pageRange,
  parseLedgerParams,
  postgrestIn,
  postgrestOr,
} from "./ledger";

describe("ledger query helpers", () => {
  it("parses page range as inclusive PostgREST offsets", () => {
    expect(pageRange(1, 20)).toEqual({ from: 0, to: 19 });
    expect(pageRange(2, 20)).toEqual({ from: 20, to: 39 });
  });

  it("clamps page size and unknown sort keys", () => {
    const params = parseLedgerParams(
      new URLSearchParams("page=0&pageSize=999&sort=hack&dir=asc"),
      ["when", "credits"],
      { key: "when", dir: "desc" }
    );
    expect(params.page).toBe(1);
    expect(params.pageSize).toBe(100);
    expect(params.sort).toEqual({ key: "when", dir: "asc" });
  });

  it("builds quoted in() filters and or() lists", () => {
    expect(postgrestIn("user_id", [])).toBeNull();
    expect(postgrestIn("module", ["Market Research", "Sync"])).toBe(
      'module.in.("Market Research","Sync")'
    );
    expect(postgrestOr([null, 'user_id.in.("a")', 'workspace_id.in.("b")'])).toBe(
      'user_id.in.("a"),workspace_id.in.("b")'
    );
  });

  it("escapes ilike wildcards", () => {
    expect(escapeIlike("100%_off")).toBe("100\\%\\_off");
    expect(dateWindowSinceIso("all")).toBeNull();
    const since = dateWindowSinceIso("7d");
    expect(since).toBeTruthy();
    expect(Date.now() - new Date(since!).getTime()).toBeGreaterThan(6 * 86_400_000);
  });
});
