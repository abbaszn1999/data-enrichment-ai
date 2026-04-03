"use client";

import { useRouter, useParams } from "next/navigation";
import { Crown, ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";

interface SubscriptionGateProps {
  workspaceId: string | null;
  children: React.ReactNode;
}

export function SubscriptionGate({ workspaceId, children }: SubscriptionGateProps) {
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug as string;
  const { subscription, isActive, isLoading } = useSubscription(workspaceId);

  if (isLoading) return <>{children}</>;

  // No subscription at all
  if (!subscription) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Crown className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Subscription Required</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You need an active subscription to use this workspace. Subscribe to unlock all platform features including AI enrichment, team collaboration, and unlimited projects.
            </p>
          </div>
          <Button onClick={() => router.push(`/w/${slug}/subscription`)} className="gap-2">
            <ArrowRight className="h-4 w-4" />
            View Plans
          </Button>
        </div>
      </div>
    );
  }

  // Subscription exists but not active (expired/cancelled past grace)
  if (!isActive) {
    const isCancelled = subscription.status === "cancelled";
    const isExpired = subscription.status === "expired";

    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">
              {isCancelled ? "Subscription Cancelled" : isExpired ? "Subscription Expired" : "Subscription Inactive"}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isCancelled
                ? "Your subscription has been cancelled. Resubscribe to regain access to all features."
                : isExpired
                ? "Your subscription has expired. Please renew to continue using the platform."
                : "Your subscription is no longer active. Please update your billing to continue."}
            </p>
          </div>
          <Button onClick={() => router.push(`/w/${slug}/subscription`)} className="gap-2">
            <ArrowRight className="h-4 w-4" />
            Manage Subscription
          </Button>
        </div>
      </div>
    );
  }

  // Active subscription — render children
  return <>{children}</>;
}

// Notification banner for subscription status issues (past_due, cancel_at_period_end)
export function SubscriptionBanner({ workspaceId }: { workspaceId: string | null }) {
  const params = useParams();
  const router = useRouter();
  const slug = params.workspaceSlug as string;
  const { subscription, isLoading } = useSubscription(workspaceId);

  if (isLoading || !subscription) return null;

  // Past due warning
  if (subscription.status === "past_due") {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-xs font-medium">Payment failed. Please update your billing information to avoid service interruption.</span>
        </div>
        <Button size="sm" variant="outline" className="text-xs h-7 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10" onClick={() => router.push(`/w/${slug}/subscription`)}>
          Update Billing
        </Button>
      </div>
    );
  }

  // Cancellation pending
  if (subscription.cancelAtPeriodEnd) {
    const endDate = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "soon";
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <Clock className="h-4 w-4" />
          <span className="text-xs font-medium">Your subscription will end on {endDate}. Your credits will be preserved but inaccessible until you resubscribe.</span>
        </div>
        <Button size="sm" variant="outline" className="text-xs h-7 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10" onClick={() => router.push(`/w/${slug}/subscription`)}>
          Resubscribe
        </Button>
      </div>
    );
  }

  return null;
}
