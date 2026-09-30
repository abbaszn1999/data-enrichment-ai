import { toast } from "sonner";
import { formatCredits } from "@/lib/format-credits";

export type BillingBlockReason = "no_credits" | "no_subscription";

const SUBSCRIPTION_PATTERN =
  /NO_SUBSCRIPTION|INACTIVE_SUBSCRIPTION|active subscription is required|no active subscription|subscription inactive/i;
const CREDITS_PATTERN =
  /NO_CREDITS|INSUFFICIENT_CREDITS|insufficient credits|no credits|out of credits|not enough credits/i;

/** Classifies an API error as a subscription or credit block, if it is one. */
export function billingBlockReason(
  status: number | null | undefined,
  message: string | null | undefined
): BillingBlockReason | null {
  const text = message ?? "";
  if (SUBSCRIPTION_PATTERN.test(text)) return "no_subscription";
  if (CREDITS_PATTERN.test(text)) return "no_credits";
  if (status === 402) return "no_credits";
  return null;
}

export function subscriptionHref(workspaceSlug: string): string {
  return `/w/${workspaceSlug}/subscription`;
}

export function showBillingBlockedToast(
  reason: BillingBlockReason,
  workspaceSlug: string | null | undefined,
  opts: { required?: number | null; remaining?: number | null; context?: string } = {}
): void {
  const action = workspaceSlug
    ? {
        label: reason === "no_subscription" ? "View plans" : "Buy credits",
        onClick: () => window.location.assign(subscriptionHref(workspaceSlug)),
      }
    : undefined;

  if (reason === "no_subscription") {
    toast.error("Subscription required", {
      id: "billing-blocked",
      description: `${opts.context ? `${opts.context} is paused. ` : ""}Your plan is not active. Choose a plan to keep using AI tools.`,
      action,
      duration: 12000,
    });
    return;
  }

  const need =
    typeof opts.required === "number" && Number.isFinite(opts.required) && opts.required > 0
      ? `This needs about ${formatCredits(opts.required)} credits and ${formatCredits(Math.max(0, opts.remaining ?? 0))} are left. `
      : "";
  toast.error("Not enough credits", {
    id: "billing-blocked",
    description: `${opts.context ? `${opts.context} is paused. ` : ""}${need}Buy more credits or upgrade your plan to continue.`,
    action,
    duration: 12000,
  });
}

/**
 * Shows the billing toast when `error` (a thrown API error carrying `status`
 * and `payload`) is a subscription or credit block. Returns whether it did.
 */
export function toastIfBillingBlocked(
  error: unknown,
  workspaceSlug: string | null | undefined,
  context?: string
): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { status?: unknown; message?: unknown; payload?: unknown };
  const status = typeof err.status === "number" ? err.status : null;
  const payload =
    err.payload && typeof err.payload === "object"
      ? (err.payload as { error?: unknown; required?: unknown; remaining?: unknown })
      : null;
  const code = typeof payload?.error === "string" ? payload.error : String(err.message ?? "");
  if (status !== 402 && !billingBlockReason(null, code)) return false;
  const reason = billingBlockReason(status, code);
  if (!reason) return false;
  showBillingBlockedToast(reason, workspaceSlug, {
    required: typeof payload?.required === "number" ? payload.required : null,
    remaining: typeof payload?.remaining === "number" ? payload.remaining : null,
    context,
  });
  return true;
}
