"use client";

import { ToolGate } from "@/components/integrations/tool-lock";
import { WebsiteRestructureShell } from "@/components/website-restructure/wr-shell";

/**
 * Website restructure — Growth engine module. Single-stage header builder:
 * agent on the left, live preview on the right.
 */
export default function WebsiteRestructurePage() {
  return (
    <ToolGate tool="website-restructure">
      <WebsiteRestructureShell />
    </ToolGate>
  );
}
