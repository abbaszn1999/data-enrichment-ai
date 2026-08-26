import { describe, expect, it } from "vitest";
import { buildPublishSchedule } from "./article-schedule";

const START = new Date("2026-08-20T09:00:00.000Z");

function localParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

describe("buildPublishSchedule", () => {
  const ids = ["a1", "b2", "c3", "d4", "e5"];

  it("schedules one article per day starting tomorrow", () => {
    const slots = buildPublishSchedule(ids, {
      timeZone: "UTC",
      startFrom: START,
    });
    expect(slots).toHaveLength(ids.length);

    const days = slots.map((slot) => localParts(slot.publishAt, "UTC").day);
    expect(days).toEqual([21, 22, 23, 24, 25]);
  });

  it("keeps every slot inside working hours in the store's timezone", () => {
    for (const timeZone of ["UTC", "Australia/Sydney", "America/Los_Angeles"]) {
      const slots = buildPublishSchedule(ids, { timeZone, startFrom: START });
      for (const slot of slots) {
        const { hour } = localParts(slot.publishAt, timeZone);
        expect(hour).toBeGreaterThanOrEqual(8);
        expect(hour).toBeLessThan(20);
      }
    }
  });

  it("never lands exactly on the hour", () => {
    const slots = buildPublishSchedule(ids, {
      timeZone: "UTC",
      startFrom: START,
    });
    for (const slot of slots) {
      expect(localParts(slot.publishAt, "UTC").minute).not.toBe(0);
    }
  });

  it("is deterministic for the same article id", () => {
    const first = buildPublishSchedule(ids, {
      timeZone: "UTC",
      startFrom: START,
    });
    const second = buildPublishSchedule(ids, {
      timeZone: "UTC",
      startFrom: START,
    });
    expect(second).toEqual(first);
  });

  it("varies the time of day between articles", () => {
    const slots = buildPublishSchedule(ids, {
      timeZone: "UTC",
      startFrom: START,
    });
    const times = new Set(
      slots.map((slot) => {
        const { hour, minute } = localParts(slot.publishAt, "UTC");
        return `${hour}:${minute}`;
      })
    );
    expect(times.size).toBeGreaterThan(1);
  });
});
