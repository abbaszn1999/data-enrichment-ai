"use client";

/**
 * "Share" button for a sheet header (Catalog Intelligence, Product Gallery,
 * Visualizer). Opens a popup with a public, revocable read-only link — the
 * link always shows the sheet's latest saved data, with no automatic expiry.
 * Editor role or above only; viewers never see this button.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RotateCw, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ShareResourceType } from "@/lib/share/links";

interface ShareLinkInfo {
  shareUrl: string | null;
}

async function fetchShareLink(params: {
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string;
}): Promise<ShareLinkInfo> {
  const search = new URLSearchParams(params);
  const res = await fetch(`/api/share-links?${search.toString()}`);
  if (!res.ok) throw new Error("Failed to load share link");
  return res.json();
}

async function postShareLink(params: {
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  regenerate?: boolean;
}): Promise<ShareLinkInfo> {
  const res = await fetch("/api/share-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to turn on sharing");
  return res.json();
}

async function deleteShareLink(params: {
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string;
}): Promise<void> {
  const res = await fetch("/api/share-links", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to turn off sharing");
}

export function ShareSheetButton({
  workspaceId,
  resourceType,
  resourceId,
  className,
}: {
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchShareLink({ workspaceId, resourceType, resourceId })
      .then((info) => {
        if (!cancelled) setShareUrl(info.shareUrl);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load sharing status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, resourceType, resourceId]);

  const turnOn = async (regenerate?: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const info = await postShareLink({ workspaceId, resourceType, resourceId, regenerate });
      setShareUrl(info.shareUrl);
      setCopied(false);
    } catch {
      setError(regenerate ? "Could not create a new link" : "Could not turn on sharing");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteShareLink({ workspaceId, resourceType, resourceId });
      setShareUrl(null);
      setCopied(false);
    } catch {
      setError("Could not turn off sharing");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select and copy the link manually");
    }
  };

  return (
    <div className={`relative ${className ?? ""}`}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-[11px]"
        onClick={() => setOpen(!open)}
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border bg-popover p-3 text-left shadow-lg">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Link2 className="h-3.5 w-3.5 text-primary" />
              Share this sheet
            </div>
            {loading ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : shareUrl ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Anyone with this link can view the latest sheet — no sign-in, no edits.
                </p>
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    value={shareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-7 flex-1 truncate rounded-md border bg-background/80 px-2 text-[10px] outline-none"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 shrink-0 p-0"
                    onClick={copyLink}
                    title="Copy link"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
                    disabled={busy}
                    onClick={() => void turnOn(true)}
                  >
                    <RotateCw className="h-3 w-3" />
                    New link
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => void turnOff()}
                  >
                    Turn off sharing
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  Create a public link so anyone can view this sheet — read-only, no sign-in required.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 w-full gap-1.5 text-[11px]"
                  disabled={busy}
                  onClick={() => void turnOn(false)}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  Turn on sharing
                </Button>
              </div>
            )}
            {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
