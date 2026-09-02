import { describe, expect, it } from "vitest";
import { shouldWriteCheckpoint } from "./checkpoint";

describe("store assistant checkpoints", () => {
  it("writes every 20 completed rows", () => {
    expect(shouldWriteCheckpoint(0)).toBe(false);
    expect(shouldWriteCheckpoint(19)).toBe(false);
    expect(shouldWriteCheckpoint(20)).toBe(true);
    expect(shouldWriteCheckpoint(40)).toBe(true);
  });
});
