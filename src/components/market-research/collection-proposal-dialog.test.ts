import { describe, expect, it } from "vitest";
import {
  CAPTURE_SCENARIOS,
  formatProposalRoiBrief,
  projectHorizon,
  proposalRoi,
} from "@/components/market-research/collection-proposal-dialog";

describe("CAPTURE_SCENARIOS", () => {
  it("models 5%, 12%, and 25% of selected search volume", () => {
    expect(CAPTURE_SCENARIOS.map((s) => s.capture)).toEqual([0.05, 0.12, 0.25]);
  });
});

describe("projectHorizon", () => {
  it("uses capture × volume × CRO × AOV for monthly sales", () => {
    const result = projectHorizon({
      monthlyVolume: 460,
      capture: 0.05,
      croPct: 2,
      aov: 80,
    });
    expect(result.sessions).toBeCloseTo(23);
    expect(result.orders).toBeCloseTo(0.46);
    expect(result.revenue).toBeCloseTo(36.8);
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

describe("formatProposalRoiBrief", () => {
  it("summarizes all three capture scenarios in one paragraph", () => {
    const brief = formatProposalRoiBrief({
      scenarios: [
        { capture: 0.05, label: "5%", note: "Weak ranks", revenue: 20 },
        { capture: 0.12, label: "12%", note: "Typical page 1", revenue: 48 },
        { capture: 0.25, label: "25%", note: "Strong #1–2", revenue: 100 },
      ],
      publishCost: 15,
    });
    expect(brief).toContain("$15");
    expect(brief).toContain("5%, 12%, or 25%");
    expect(brief).toContain("$20");
    expect(brief).toContain("$48");
    expect(brief).toContain("$100");
    expect(brief).toContain("1.3×");
    expect(brief).toContain("6.7×");
  });
});
