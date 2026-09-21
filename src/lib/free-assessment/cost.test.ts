import { describe, expect, it } from "vitest";
import {
  actualExtractCostUsd,
  actualProbeCostUsd,
  estimateExtractCostUsd,
  estimateProbeCostUsd,
} from "./cost";

describe("free-assessment extract pricing", () => {
  it("matches the main Growth Engine rate of $6 per 1,000 keyword rows", () => {
    expect(estimateProbeCostUsd(1)).toBe(0.002);
    expect(estimateExtractCostUsd(2400)).toBe(14.4);
    expect(actualExtractCostUsd(1)).toBe(0.006);
    expect(actualExtractCostUsd(1850)).toBe(11.1);
    expect(actualProbeCostUsd(3)).toBe(0.006);
  });
});
