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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
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
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Settings className="h-5 w-5" /> Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Manage workspace settings
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* General Settings */}
      <Card className="p-5 space-y-5">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Building2 className="h-4 w-4" /> General
        </h2>

        <div className="space-y-2">
          <Label className="text-xs font-medium">Workspace Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10"
            disabled={!permissions.canAdmin}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">CMS / Platform Type</Label>
          <select
            value={cmsType}
            onChange={(e) => setCmsType(e.target.value)}
            className="w-full h-10 px-3 text-sm rounded-lg border bg-background"
            disabled={!permissions.canAdmin}
          >
            {CMS_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background resize-none"
            disabled={!permissions.canAdmin}
          />
        </div>

        {permissions.canAdmin && (
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save Changes
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Danger Zone */}
      {permissions.isOwner && (
        <Card className="p-5 border-destructive/30 space-y-4">
          <h2 className="text-sm font-semibold text-destructive flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> Danger Zone
          </h2>
          <p className="text-xs text-muted-foreground">
            Deleting a workspace permanently removes all products, categories,
            imports, and files. This cannot be undone.
          </p>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Type <strong>{workspace.name}</strong> to confirm
            </Label>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={workspace.name}
              className="h-9"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={deleteConfirm !== workspace.name || deleting}
            onClick={handleDelete}
            className="gap-1.5"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete Workspace
          </Button>
        </Card>
      )}
    </div>
  );
}
