"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, Settings } from "lucide-react";
import { PageLoader } from "@/components/brand/page-loader";
import { Button } from "@/components/ui/button";
import { useWorkspaceContext } from "@/app/(dashboard)/w/[workspaceSlug]/workspace-context";
import { SHOPIFY_TOOL_ACCESS, type StoreToolId, type ToolLock } from "@/lib/integrations/shopify-access";

const toolName = (tool: StoreToolId) => SHOPIFY_TOOL_ACCESS.find((t) => t.id === tool)?.name ?? "This tool";

/** Why a tool is locked and what to do about it: the sidebar's popover and the page's lock screen. */
export function ToolLockDetails({
  tool,
  lock,
  canAdmin,
  settingsHref,
}: {
  tool: StoreToolId;
  lock: NonNullable<ToolLock>;
  canAdmin: boolean;
  settingsHref: string;
}) {
  const name = toolName(tool);
  const title = lock.reason === "missing-scopes" ? `${name} needs more access` : lock.reason === "no-store" ? "Connect your store first" : `${name} needs another store`;
  return (
    <div className="space-y-3 text-start">
      <div>
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {lock.reason === "missing-scopes"
            ? "Your Shopify app has not given these scopes yet:"
            : lock.reason === "no-store"
              ? `${name} works on your store. Connect one in Settings to open it.`
              : `${name} works with Shopify and WooCommerce stores.`}
        </p>
      </div>
      {lock.reason === "missing-scopes" && (
        <div className="flex flex-wrap gap-1">
          {lock.missing.map((scope) => (
            <code key={scope} className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10.5px] text-amber-800 dark:text-amber-300">
              {scope}
            </code>
          ))}
        </div>
      )}
      {canAdmin ? (
        <Button asChild size="sm" className="h-8 w-full gap-1.5 rounded-lg bg-[#400095] text-[12px] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90">
          <Link href={settingsHref}>
            <Settings className="h-3.5 w-3.5" />
            {lock.reason === "missing-scopes" ? "Fix in Settings" : "Open Settings"}
          </Link>
        </Button>
      ) : (
        <p className="text-[12px] text-muted-foreground">Ask the workspace owner or an admin to do this.</p>
      )}
    </div>
  );
}

/** Opens the tool's page only when the tool is open: a direct link gets the same lock as the sidebar. */
export function ToolGate({ tool, children }: { tool: StoreToolId; children: ReactNode }) {
  const { workspace, role, wsLoading, toolLocks } = useWorkspaceContext();
  if (wsLoading || !workspace) return <PageLoader />;
  const lock = toolLocks[tool];
  if (!lock) return <>{children}</>;
  return (
    <div className="autommerce-dashboard flex h-full min-h-0 flex-1 items-center justify-center p-8 [font-family:var(--brand-font)]">
      <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-sm">
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
          <Lock className="h-5 w-5" />
        </span>
        <ToolLockDetails tool={tool} lock={lock} canAdmin={role === "owner" || role === "admin"} settingsHref={`/w/${workspace.slug}/settings`} />
      </div>
    </div>
  );
}
