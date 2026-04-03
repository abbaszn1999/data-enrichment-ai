"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Building2,
  ShieldAlert,
  Globe,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import { updateWorkspace, deleteWorkspace } from "@/lib/supabase";

const CMS_TYPES = [
  { value: "shopify", label: "Shopify" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "bigcommerce", label: "BigCommerce" },
  { value: "salla", label: "Salla" },
  { value: "zid", label: "Zid" },
  { value: "magento", label: "Magento" },
  { value: "custom", label: "Custom / Other" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { workspace, role } = useWorkspaceContext();
  const permissions = useRole(role);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cmsType, setCmsType] = useState("custom");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setDescription(workspace.description || "");
      setCmsType(workspace.cms_type || "custom");
    }
  }, [workspace]);

  const handleSave = async () => {
    if (!workspace) return;
    setError("");
    setSaving(true);
    try {
      await updateWorkspace(workspace.id, {
        name: name.trim(),
        description: description.trim(),
        cms_type: cmsType,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!workspace || deleteConfirm !== workspace.name) return;
    setDeleting(true);
    try {
      await deleteWorkspace(workspace.id);
      router.push("/workspaces");
    } catch (err: any) {
      setError(err?.message || "Failed to delete workspace");
      setDeleting(false);
    }
  };

  if (!workspace) return null;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Settings</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Manage workspace configuration for{" "}
          <span className="font-semibold text-foreground">{workspace.name}</span>
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* General Settings */}
      <div className="rounded-2xl border-2 border-border/60 p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold">General</h2>
            <p className="text-[11px] text-muted-foreground">Basic workspace information</p>
          </div>
        </div>

        <div className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Workspace Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
              disabled={!permissions.canAdmin}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">CMS / Platform Type</Label>
            <select
              value={cmsType}
              onChange={(e) => setCmsType(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
              disabled={!permissions.canAdmin}
            >
              {CMS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">
              Description{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 text-sm rounded-lg border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
              disabled={!permissions.canAdmin}
            />
          </div>
        </div>

        {permissions.canAdmin && (
          <div className="flex items-center gap-3 pt-2 border-t border-border/50">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved successfully
              </span>
            )}
          </div>
        )}
      </div>

      {/* Danger Zone */}
      {permissions.isOwner && (
        <div className="rounded-2xl border-2 border-destructive/30 p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-destructive/10 flex items-center justify-center">
              <ShieldAlert className="h-4.5 w-4.5 text-destructive" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-destructive">Danger Zone</h2>
              <p className="text-[11px] text-muted-foreground">Irreversible and destructive actions</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Deleting a workspace permanently removes all products, categories,
            imports, and files. <strong className="text-foreground">This action cannot be undone.</strong>
          </p>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Type <strong className="text-foreground">{workspace.name}</strong> to confirm deletion
            </Label>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={workspace.name}
              className="h-10 border-destructive/30 focus:ring-destructive/30"
            />
          </div>

          <Button
            variant="destructive"
            disabled={deleteConfirm !== workspace.name || deleting}
            onClick={handleDelete}
            className="gap-2"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Workspace
          </Button>
        </div>
      )}
    </div>
  );
}
