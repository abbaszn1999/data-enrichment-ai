import { describe, expect, it } from "vitest";
import { mapLimit } from "./map-limit";

describe("mapLimit", () => {
  it("caps concurrent work", async () => {
    let inFlight = 0;
    let max = 0;
    const values = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return n * 2;
    });
    expect(values).toEqual([2, 4, 6, 8, 10]);
    expect(max).toBeLessThanOrEqual(2);
  });
});
