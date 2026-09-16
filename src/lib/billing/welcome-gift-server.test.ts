import { describe, expect, it } from "vitest";
import { stampFirstPaidAtIfNull } from "./welcome-gift-server";

function mockAdmin() {
  const calls: Array<[string, ...unknown[]]> = [];
  const query: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return query;
  };
  query.update = chain("update");
  query.is = chain("is");
  query.eq = chain("eq");
  query.not = chain("not");
  query.then = (resolve: (value: { error: null }) => unknown) =>
    Promise.resolve({ error: null }).then(resolve);

  return {
    calls,
    admin: {
      from: (table: string) => {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}

describe("stampFirstPaidAtIfNull", () => {
  it("updates only when first_paid_at is still null", async () => {
    const { admin, calls } = mockAdmin();
    await stampFirstPaidAtIfNull(admin as never, { userId: "user-1" });
    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", "user_subscriptions"],
        ["is", "first_paid_at", null],
        ["eq", "status", "active"],
        ["not", "stripe_subscription_id", "is", null],
        ["eq", "user_id", "user-1"],
      ])
    );
    const update = calls.find((call) => call[0] === "update")?.[1] as {
      first_paid_at?: string;
    };
    expect(update.first_paid_at).toEqual(expect.any(String));
  });

  it("looks up by Stripe subscription id on subscription.updated", async () => {
    const { admin, calls } = mockAdmin();
    await stampFirstPaidAtIfNull(admin as never, {
      stripeSubscriptionId: "sub_abc",
    });
    expect(calls).toContainEqual(["eq", "stripe_subscription_id", "sub_abc"]);
    expect(calls.some((call) => call[0] === "eq" && call[1] === "user_id")).toBe(
      false
    );
  });
});
