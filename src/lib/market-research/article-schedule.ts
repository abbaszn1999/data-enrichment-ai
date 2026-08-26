/**
 * Publishing calendar for generated articles.
 *
 * One article per day, at a different minute each day. A fixed hour would make
 * the whole blog read as machine output, which is exactly the signal we don't
 * want, so the time is jittered inside working hours in the *store's* timezone —
 * a shop selling to Sydney should not publish at 3am local time.
 *
 * The jitter is derived from the article id, so re-running a sync produces the
 * same schedule instead of silently reshuffling the calendar.
 */

const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 20;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  }
  return hash;
}

/**
 * Offset in minutes between UTC and the given IANA zone at that instant,
 * including daylight saving. Positive means the zone is ahead of UTC.
 */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second")
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return 0;
  }
}

export type ScheduledSlot = {
  articleId: string;
  /** ISO 8601 UTC instant to hand to Shopify's publishDate. */
  publishAt: string;
};

/**
 * Assigns one slot per article on consecutive days, starting tomorrow so
 * nothing goes live the moment the merchant clicks sync.
 */
export function buildPublishSchedule(
  articleIds: string[],
  options: { timeZone?: string | null; startFrom?: Date } = {}
): ScheduledSlot[] {
  const timeZone = options.timeZone?.trim() || "UTC";
  const base = options.startFrom ?? new Date();

  return articleIds.map((articleId, index) => {
    const hash = hashString(articleId);
    const hour =
      WINDOW_START_HOUR + (hash % (WINDOW_END_HOUR - WINDOW_START_HOUR));
    // Avoid landing on the hour, which reads as scheduled automation.
    const minute = 3 + Math.floor(hash / 97) % 55;

    // Walk the calendar in local days, then convert that wall-clock time back.
    const day = new Date(base.getTime());
    day.setUTCDate(day.getUTCDate() + index + 1);

    const offset = zoneOffsetMinutes(day, timeZone);
    const wallClockUtc = Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour,
      minute,
      0
    );
    const publishAt = new Date(wallClockUtc - offset * 60000);

    return { articleId, publishAt: publishAt.toISOString() };
  });
}
