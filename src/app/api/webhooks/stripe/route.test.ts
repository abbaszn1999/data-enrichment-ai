import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const PERIOD_START = Date.parse("2026-10-01T00:00:00.000Z") / 1000;

const db = {
  events: new Map<string, unknown>(),
  subRow: { credits_reset_at: "2026-09-01T00:00:05.000Z" } as Record<string, unknown> | null,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  walletOk: true,
};

function from(table: string) {
  const filters: Record<string, unknown> = {};
  const q: Record<string, (...args: never[]) => unknown> = {};
  q.select = () => q;
  q.eq = (key: string, value: unknown) => {
    filters[key] = value;
    return q;
  };
  q.maybeSingle = async () => {
    if (table === "webhook_events") {
      return { data: db.events.has(String(filters.id)) ? { id: filters.id } : null, error: null };
    }
    if (table === "user_subscriptions") return { data: db.subRow, error: null };
    if (table === "subscription_plans") return { data: { name: "growth" }, error: null };
    return { data: null, error: null };
  };
  q.insert = async (row: { id: string }) => {
    if (table === "webhook_events") {
      if (db.events.has(row.id)) return { error: { code: "23505", message: "duplicate key" } };
      db.events.set(row.id, row);
    }
    return { error: null };
  };
  q.delete = () => ({
    eq: async (_key: string, value: string) => {
      if (table === "webhook_events") db.events.delete(value);
      return { error: null };
    },
  });
  q.update = (patch: Record<string, unknown>) => ({
    eq: async () => {
      db.updates.push({ table, patch });
      return { error: null };
    },
  });
  q.upsert = async (patch: Record<string, unknown>) => {
    db.updates.push({ table, patch });
    return { error: null };
  };
  return q;
}

const admin = {
  from,
  rpc: async (name: string, args: Record<string, unknown>) => {
    db.rpcCalls.push({ name, args });
    return { data: { success: true, duplicate: false }, error: null };
  },
};

vi.mock("stripe", () => ({
  default: { webhooks: { constructEvent: (body: string) => JSON.parse(body) } },
}));
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        status: "active",
        cancel_at_period_end: false,
        items: {
          data: [
            {
              price: { id: "price_growth", recurring: { interval: "month" } },
              current_period_start: PERIOD_START,
              current_period_end: PERIOD_START + 30 * 86400,
            },
          ],
        },
      }),
    },
  },
  findPlanByStripePriceId: async () => ({ id: "plan_growth" }),
  invalidateSubscriptionCache: () => undefined,
}));
vi.mock("@/lib/billing/plans", () => ({ isSelfServePlanName: () => true }));
vi.mock("@/lib/billing/welcome-gift-server", () => ({ stampFirstPaidAtIfNull: async () => undefined }));
vi.mock("@/lib/workspace-context", () => ({ clearWorkspaceContextCache: () => undefined }));
vi.mock("@/lib/wallet/server", () => ({
  creditWorkspaceWallet: async () =>
    db.walletOk ? { ok: true } : { ok: false, message: "database unavailable" },
}));
vi.mock("@/lib/free-assessment/wallet-server", () => ({ creditFaWallet: async () => ({ ok: true }) }));

import { POST } from "./route";

const deliver = (event: Record<string, unknown>) =>
  POST(
    new NextRequest("http://test/api/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "stripe-signature": "sig" },
    })
  );

const walletTopup = {
  id: "evt_wallet",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_wallet",
      mode: "payment",
      payment_status: "paid",
      amount_total: 5000,
      metadata: { userId: "u1", walletTopup: "1", workspaceId: "w1" },
    },
  },
};

const creditTopup = (paymentStatus: string) => ({
  id: `evt_credits_${paymentStatus}`,
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_credits",
      mode: "payment",
      payment_status: paymentStatus,
      amount_total: 50000,
      payment_intent: "pi_1",
      metadata: { userId: "u1", credits: "1000" },
    },
  },
});

const renewalInvoice = {
  id: "evt_invoice",
  type: "invoice.paid",
  data: {
    object: {
      billing_reason: "subscription_cycle",
      parent: { subscription_details: { subscription: "sub_1" } },
    },
  },
};

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  db.events.clear();
  db.subRow = { credits_reset_at: "2026-09-01T00:00:05.000Z" };
  db.updates = [];
  db.rpcCalls = [];
  db.walletOk = true;
});

describe("Stripe webhook", () => {
  it("releases the event when a handler fails so Stripe's retry is processed", async () => {
    db.walletOk = false;
    const failed = await deliver(walletTopup);
    expect(failed.status).toBe(500);
    expect(db.events.has("evt_wallet")).toBe(false);

    db.walletOk = true;
    const retried = await deliver(walletTopup);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ received: true });
  });

  it("acknowledges an already processed event as a duplicate", async () => {
    await deliver(walletTopup);
    const again = await deliver(walletTopup);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
  });

  it("grants purchased credits through the atomic RPC keyed by checkout session", async () => {
    await deliver(creditTopup("paid"));
    expect(db.rpcCalls).toEqual([
      {
        name: "grant_purchased_credits",
        args: {
          p_user_id: "u1",
          p_credits: 1000,
          p_amount_paid: 500,
          p_checkout_session_id: "cs_credits",
          p_payment_intent_id: "pi_1",
        },
      },
    ]);
  });

  it("does not grant credits before the payment has cleared", async () => {
    await deliver(creditTopup("unpaid"));
    expect(db.rpcCalls).toEqual([]);
  });

  it("resets included credits once for a new paid period", async () => {
    await deliver(renewalInvoice);
    const patch = db.updates.find((u) => u.table === "user_subscriptions")?.patch;
    expect(patch).toMatchObject({ status: "active", credits_used: 0, plan_id: "plan_growth" });
  });

  it("does not reset credits for an invoice in a period that was already reset", async () => {
    db.subRow = { credits_reset_at: "2026-10-01T00:00:04.000Z" };
    await deliver({ ...renewalInvoice, id: "evt_invoice_again" });
    const patch = db.updates.find((u) => u.table === "user_subscriptions")?.patch;
    expect(patch).toBeDefined();
    expect(patch).not.toHaveProperty("credits_used");
  });
});
