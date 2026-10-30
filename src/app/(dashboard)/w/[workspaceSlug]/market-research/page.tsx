"use client";

import { ToolGate } from "@/components/integrations/tool-lock";
import { MarketResearchShell } from "@/components/market-research/market-research-shell";

/**
 * Market research — Growth engine module (stages 1–3 frontend preview).
 * Full logic and Wallet billing land in later iterations.
 */
export default function MarketResearchPage() {
  return (
    <ToolGate tool="market-research">
      <MarketResearchShell />
    </ToolGate>
  );
}
