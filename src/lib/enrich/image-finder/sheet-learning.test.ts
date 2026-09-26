import { describe, expect, it } from "vitest";
import { rowsNeedingRecheck, SheetDomainLearner } from "./sheet-learning";

const foundOn = (...pages: string[]) => ({
  imageUrls: pages.map((pageUrl) => ({ imageUrl: `${pageUrl}/img.jpg`, pageUrl, title: "Product image" })),
});
const notFound = { imageUrls: [], imageUrls__notFoundReason: "Searched everywhere" };

describe("SheetDomainLearner", () => {
  it("counts each website once per verified row and only suggests repeat websites", () => {
    const learner = new SheetDomainLearner();
    learner.addRow(foundOn("https://www.store.test/p/1", "https://store.test/p/1b"));
    learner.addRow(foundOn("https://store.test/p/2"));
    learner.addRow(foundOn("https://once.test/p/3"));
    learner.addRow(notFound);
    expect(learner.top()).toEqual(["store.test"]);
  });

  it("rebuilds from rows already found in the sheet", () => {
    const learner = SheetDomainLearner.fromRows([
      { enrichedData: foundOn("https://store.test/a") },
      { enrichedData: foundOn("https://store.test/b") },
    ]);
    expect(learner.top()).toEqual(["store.test"]);
  });
});

describe("rowsNeedingRecheck", () => {
  const rows = [
    { id: "found", status: "done", enrichedData: foundOn("https://store.test/a") },
    { id: "miss-tried", status: "done", enrichedData: notFound },
    { id: "miss-new", status: "done", enrichedData: notFound },
    { id: "miss-done", status: "done", enrichedData: notFound },
    { id: "errored", status: "error", enrichedData: {} },
    { id: "other-run", status: "done", enrichedData: notFound },
  ];

  it("picks Not-found rows of this run that have not seen the learned websites and were not re-checked", () => {
    const result = rowsNeedingRecheck({
      rows,
      targetIds: ["found", "miss-tried", "miss-new", "miss-done", "errored"],
      rechecked: new Set(["miss-done"]),
      learnedDomains: ["store.test"],
      domainsTriedByRow: new Map([["miss-tried", ["store.test"]]]),
    });
    expect(result).toEqual(["miss-new"]);
  });

  it("does nothing when the sheet has not taught any website yet", () => {
    expect(
      rowsNeedingRecheck({ rows, targetIds: ["miss-new"], rechecked: new Set(), learnedDomains: [], domainsTriedByRow: new Map() })
    ).toEqual([]);
  });
});
