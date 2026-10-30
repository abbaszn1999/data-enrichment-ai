"use client";

import { ToolGate } from "@/components/integrations/tool-lock";
import { SyncDashboard } from "@/components/growth-sync/sync-dashboard";

export default function GrowthSyncDashboardPage() {
  return (
    <ToolGate tool="growth-sync">
      <SyncDashboard />
    </ToolGate>
  );
}
