import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_WELCOME_GIFT,
  WELCOME_GIFT_CREDITS,
  WELCOME_GIFT_DAYS,
  formatWelcomeGiftRemaining,
  isWelcomeGiftOpen,
  welcomeGiftExpiresAt,
  welcomeGiftFromSubscription,
  welcomeGiftState,
} from "./welcome-gift";

const now = new Date("2026-09-16T12:00:00.000Z");
const firstPaid = new Date("2026-09-10T12:00:00.000Z");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const paidBase = {
  isOwner: true,
  planName: "growth" as const,
  status: "active",
  stripeSubscriptionId: "sub_123",
  firstPaidAt: firstPaid.toISOString(),
  claimedAt: null as string | null,
  now,
};

describe("welcomeGiftState", () => {
  it("is eligible for a first Growth or Pro sub inside 30 days", () => {
    expect(welcomeGiftState(paidBase).eligible).toBe(true);
    expect(welcomeGiftState({ ...paidBase, planName: "pro" }).eligible).toBe(true);
    expect(welcomeGiftState(paidBase).credits).toBe(WELCOME_GIFT_CREDITS);
    expect(welcomeGiftState(paidBase).expiresAt).toBe(
      welcomeGiftExpiresAt(firstPaid).toISOString()
    );
  });

  it("is eligible on first paid day 1", () => {
    expect(
      welcomeGiftState({ ...paidBase, firstPaidAt: now.toISOString(), now }).eligible
    ).toBe(true);
  });

  it("hides the gift on trial even if a first_paid_at were set", () => {
    expect(
      welcomeGiftState({
        ...paidBase,
        planName: "trial",
        status: "trialing",
        stripeSubscriptionId: null,
        firstPaidAt: null,
      }).eligible
    ).toBe(false);
  });

  it("is closed on day 31", () => {
    const late = new Date(firstPaid.getTime() + (WELCOME_GIFT_DAYS + 1) * 86_400_000);
    expect(welcomeGiftState({ ...paidBase, now: late }).eligible).toBe(false);
  });

  it("is closed at the exact expiry instant", () => {
    const expires = welcomeGiftExpiresAt(firstPaid);
    expect(welcomeGiftState({ ...paidBase, now: expires }).eligible).toBe(false);
  });

  it("is closed after claim", () => {
    const claimed = welcomeGiftState({
      ...paidBase,
      claimedAt: "2026-09-11T12:00:00.000Z",
    });
    expect(claimed.eligible).toBe(false);
    expect(claimed.claimedAt).toBe("2026-09-11T12:00:00.000Z");
    expect(isWelcomeGiftOpen(claimed, now)).toBe(false);
  });

  it("is closed when cancelled or missing Stripe", () => {
    expect(welcomeGiftState({ ...paidBase, status: "cancelled" }).eligible).toBe(
      false
    );
    expect(
      welcomeGiftState({ ...paidBase, stripeSubscriptionId: null }).eligible
    ).toBe(false);
  });

  it("is closed for Enterprise, Starter, and teammates", () => {
    expect(welcomeGiftState({ ...paidBase, planName: "enterprise" }).eligible).toBe(
      false
    );
    expect(welcomeGiftState({ ...paidBase, planName: "starter" }).eligible).toBe(
      false
    );
    expect(welcomeGiftState({ ...paidBase, isOwner: false }).eligible).toBe(false);
  });

  it("treats a backfilled first_paid_at 31 days ago as expired", () => {
    const backfilled = new Date(now.getTime() - 31 * 86_400_000);
    expect(
      welcomeGiftState({ ...paidBase, firstPaidAt: backfilled }).eligible
    ).toBe(false);
  });

  it("returns an empty payload when nothing is paid yet", () => {
    expect(EMPTY_WELCOME_GIFT.eligible).toBe(false);
    expect(EMPTY_WELCOME_GIFT.credits).toBe(WELCOME_GIFT_CREDITS);
    expect(
      welcomeGiftFromSubscription({
        isOwner: true,
        planName: "trial",
        subscription: null,
        now,
      }).eligible
    ).toBe(false);
  });

  it("hides the ticker after the client clock passes expiresAt", () => {
    const open = welcomeGiftState(paidBase);
    expect(isWelcomeGiftOpen(open, now)).toBe(true);
    expect(isWelcomeGiftOpen(open, welcomeGiftExpiresAt(firstPaid))).toBe(false);
  });
});

describe("formatWelcomeGiftRemaining", () => {
  it("shows days and hours while more than a day remains", () => {
    const expires = new Date("2026-09-20T18:00:00.000Z");
    expect(formatWelcomeGiftRemaining(expires, now)).toBe("4d 6h");
  });

  it("shows hours and minutes under a day", () => {
    const expires = new Date("2026-09-16T15:40:00.000Z");
    expect(formatWelcomeGiftRemaining(expires, now)).toBe("3h 40m");
  });

  it("shows minutes under an hour", () => {
    const expires = new Date("2026-09-16T12:12:00.000Z");
    expect(formatWelcomeGiftRemaining(expires, now)).toBe("12m");
  });
});

describe("welcome gift persistence", () => {
  it("claim RPC only adds 5000 when claimed_at is still null", () => {
    const sql = readFileSync(
      resolve(root, "supabase/migrations/20260916_welcome_credit_gift.sql"),
      "utf8"
    );
    expect(sql).toContain("bonus_credits = COALESCE(us.bonus_credits, 0) + 5000");
    expect(sql).toContain("welcome_gift_claimed_at IS NULL");
    expect(sql).toContain("sp.name IN ('growth', 'pro')");
    expect(sql).toContain("NOW() - interval '31 days'");
  });

  it("does not stamp first_paid_at on trial grant", () => {
    const src = readFileSync(resolve(root, "src/lib/trial-server.ts"), "utf8");
    expect(src).not.toMatch(/first_paid_at\s*:/);
    expect(src).not.toMatch(/first_paid_at\s*=/);
  });

  it("stamps first_paid_at from Stripe paid activation without auto-crediting", () => {
    const src = readFileSync(
      resolve(root, "src/app/api/webhooks/stripe/route.ts"),
      "utf8"
    );
    expect(src).toContain("stampFirstPaidAtIfNull");
    expect(src).not.toMatch(/bonus_credits:\s*0/);
    expect(src).not.toContain("WELCOME_GIFT_CREDITS");
  });
});
