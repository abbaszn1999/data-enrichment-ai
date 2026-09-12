import { describe, expect, it } from "vitest";
import {
  CAPTURE_SCENARIOS,
  formatProposalRoiLine,
  projectHorizon,
  proposalRoi,
} from "@/components/market-research/collection-proposal-dialog";

describe("CAPTURE_SCENARIOS", () => {
  it("models 3%, 9%, and 15% of selected search volume", () => {
    expect(CAPTURE_SCENARIOS.map((s) => s.capture)).toEqual([0.03, 0.09, 0.15]);
  });
});

describe("projectHorizon", () => {
  it("uses capture × volume × CRO × AOV for monthly sales", () => {
    const result = projectHorizon({
      monthlyVolume: 460,
      capture: 0.03,
      croPct: 2,
      aov: 80,
    });
    expect(result.sessions).toBeCloseTo(13.8);
    expect(result.orders).toBeCloseTo(0.276);
    expect(result.revenue).toBeCloseTo(22.08);
  });
});

describe("proposalRoi", () => {
  it("returns sales / cost and (sales - cost) / cost", () => {
    const roi = proposalRoi(257.6, 95);
    expect(roi).not.toBeNull();
    expect(roi!.multiple).toBeCloseTo(257.6 / 95);
    expect(roi!.pct).toBeCloseTo(((257.6 - 95) / 95) * 100);
  });

  it("returns null when publish cost is 0", () => {
    expect(proposalRoi(100, 0)).toBeNull();
  });
});

describe("formatProposalRoiLine", () => {
  it("names the capture percent, sales, publish cost, and ROI", () => {
    const line = formatProposalRoiLine({
      capturePct: 15,
      monthlySales: 190,
      publishCost: 95,
    });
    expect(line).toContain("15%");
    expect(line).toContain("$190");
    expect(line).toContain("$95");
    expect(line).toContain("2.0×");
    expect(line).toContain("ROI 100%");
  });
});
