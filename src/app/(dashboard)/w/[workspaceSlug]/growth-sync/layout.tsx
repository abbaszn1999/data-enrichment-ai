import { GrowthSyncShell } from "@/components/growth-sync/growth-sync-shell";

export default function GrowthSyncLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <GrowthSyncShell>{children}</GrowthSyncShell>
    </div>
  );
}
