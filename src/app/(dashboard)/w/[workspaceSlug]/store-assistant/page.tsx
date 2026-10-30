"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageLoader } from "@/components/brand/page-loader";
import { ToolGate } from "@/components/integrations/tool-lock";
import { StoreAgentWorkspace } from "@/components/store-agent/store-agent-workspace";
import { useRole } from "@/hooks/use-role";
import { getWorkspaceIntegration } from "@/lib/supabase";
import { useWorkspaceStore } from "@/store/workspace-store";
import { useWorkspaceContext } from "../workspace-context";

export default function StoreAgentPage() {
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace, role } = useWorkspaceContext();
  const { canEdit } = useRole(role);
  const invalidateCredits = useWorkspaceStore((s) => s.invalidateCredits);
  const [storeName, setStoreName] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace?.id) return;
    getWorkspaceIntegration(workspace.id)
      .then((integration) => setStoreName(integration?.integration_name || "your store"))
      .catch(() => setStoreName("your store"));
  }, [workspace?.id]);

  if (!workspace?.id || storeName === null) return <PageLoader />;
  return (
    <ToolGate tool="store-assistant">
      <StoreAgentWorkspace
        workspaceId={workspace.id}
        basePath={`/w/${slug}`}
        storeName={storeName}
        canEdit={canEdit}
        onCreditsChanged={invalidateCredits}
      />
    </ToolGate>
  );
}
