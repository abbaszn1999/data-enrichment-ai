"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Settings,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Trash2,
  Building2,
  ShieldAlert,
  Globe,
  Save,
  PlugZap,
  Store,
  Link2Off,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspaceContext } from "../layout";
import { useRole } from "@/hooks/use-role";
import {
  updateWorkspace,
  deleteWorkspace,
  getWorkspaceIntegration,
  testShopifyIntegration,
  saveShopifyIntegration,
  disconnectWorkspaceIntegration,
  type WorkspaceIntegration,
} from "@/lib/supabase";

const CMS_TYPES = [
  { value: "shopify", label: "Shopify" },
  { value: "woocommerce", label: "WooCommerce" },
  { value: "bigcommerce", label: "BigCommerce" },
  { value: "salla", label: "Salla" },
  { value: "zid", label: "Zid" },
  { value: "magento", label: "Magento" },
  { value: "custom", label: "Custom / Other" },
];

const INTEGRATION_PROVIDERS = [
  {
    value: "shopify" as const,
    label: "Shopify",
    description: "Configure your Shopify store connection",
    available: true,
  },
  {
    value: "woocommerce" as const,
    label: "WooCommerce",
    description: "Coming soon",
    available: false,
  },
  {
    value: "wordpress" as const,
    label: "WordPress",
    description: "Coming soon",
    available: false,
  },
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
  const [integration, setIntegration] = useState<WorkspaceIntegration | null>(null);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationDialogOpen, setIntegrationDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<"shopify" | "woocommerce" | "wordpress" | null>(null);
  const [integrationStep, setIntegrationStep] = useState<"select" | "configure">("select");
  const [integrationName, setIntegrationName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [adminApiToken, setAdminApiToken] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [testedConnection, setTestedConnection] = useState<{ accountLabel: string; baseUrl: string; storeDomain?: string; storeName?: string | null } | null>(null);
  const [savingIntegration, setSavingIntegration] = useState(false);
  const [disconnectingIntegration, setDisconnectingIntegration] = useState(false);
  const [integrationError, setIntegrationError] = useState("");
  const [integrationSuccess, setIntegrationSuccess] = useState("");

  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setDescription(workspace.description || "");
      setCmsType(workspace.cms_type || "custom");
    }
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;

    async function loadIntegration() {
      if (!workspace || !permissions.canAdmin) return;
      setIntegrationLoading(true);
      try {
        const data = await getWorkspaceIntegration(workspace.id);
        if (!cancelled) {
          setIntegration(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setIntegrationError(err?.message || "Failed to load integration");
        }
      } finally {
        if (!cancelled) {
          setIntegrationLoading(false);
        }
      }
    }

    loadIntegration();

    return () => {
      cancelled = true;
    };
  }, [workspace, permissions.canAdmin]);

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

  const resetIntegrationDialog = () => {
    setSelectedProvider(null);
    setIntegrationStep("select");
    setIntegrationName("");
    setStoreUrl("");
    setAdminApiToken("");
    setTestedConnection(null);
    setIntegrationError("");
  };

  const handleOpenIntegrationDialog = () => {
    resetIntegrationDialog();
    setIntegrationDialogOpen(true);
  };

  const handleTestConnection = async () => {
    if (!workspace || selectedProvider !== "shopify") return;
    setIntegrationError("");
    setTestingConnection(true);
    try {
      const result = await testShopifyIntegration({
        workspaceId: workspace.id,
        integrationName,
        storeUrl,
        adminApiToken,
      });
      setTestedConnection({
        accountLabel: result.accountLabel,
        baseUrl: result.baseUrl,
        storeDomain: result.metadata?.storeDomain,
        storeName: result.metadata?.storeName,
      });
    } catch (err: any) {
      setTestedConnection(null);
      setIntegrationError(err?.message || "Failed to test Shopify connection");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveIntegration = async () => {
    if (!workspace || selectedProvider !== "shopify") return;
    setIntegrationError("");
    setSavingIntegration(true);
    try {
      const savedIntegration = await saveShopifyIntegration({
        workspaceId: workspace.id,
        integrationName,
        storeUrl,
        adminApiToken,
      });
      setIntegration(savedIntegration);
      setIntegrationSuccess(`Connected to ${savedIntegration.integration_name}`);
      setIntegrationDialogOpen(false);
      resetIntegrationDialog();
    } catch (err: any) {
      setIntegrationError(err?.message || "Failed to save Shopify integration");
    } finally {
      setSavingIntegration(false);
    }
  };

  const handleDisconnectIntegration = async () => {
    if (!workspace) return;
    setIntegrationError("");
    setDisconnectingIntegration(true);
    try {
      await disconnectWorkspaceIntegration(workspace.id);
      setIntegration(null);
      setIntegrationSuccess("Integration disconnected");
    } catch (err: any) {
      setIntegrationError(err?.message || "Failed to disconnect integration");
    } finally {
      setDisconnectingIntegration(false);
    }
  };

  if (!workspace) return null;

  const connectedStoreDomain = typeof integration?.config?.store_domain === "string"
    ? integration.config.store_domain
    : integration?.base_url;

  const selectedProviderConfig = selectedProvider
    ? INTEGRATION_PROVIDERS.find((provider) => provider.value === selectedProvider) ?? null
    : null;

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

      {integrationError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20">
          <AlertCircle className="h-4 w-4 shrink-0" /> {integrationError}
        </div>
      )}

      {integrationSuccess && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 text-green-600 text-sm border border-green-500/20">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {integrationSuccess}
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
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
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

      <div className="rounded-2xl border-2 border-border/60 p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <PlugZap className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Integrations</h2>
            <p className="text-[11px] text-muted-foreground">Connect one store platform to this workspace</p>
          </div>
        </div>

        {integrationLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading integration...
          </div>
        ) : integration ? (
          <Card className="p-4 border-border/60 bg-muted/20">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">{integration.integration_name}</span>
                  <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/10">Connected</Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" />
                    <span className="font-medium text-foreground">{connectedStoreDomain}</span>
                  </p>
                  <p>Provider: {integration.provider}</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleDisconnectIntegration}
                disabled={disconnectingIntegration}
                className="gap-2"
              >
                {disconnectingIntegration ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2Off className="h-4 w-4" />
                )}
                Disconnect
              </Button>
            </div>
          </Card>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 p-5 bg-muted/20 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold">No integration connected</p>
              <p className="text-xs text-muted-foreground">Connect Shopify now. Additional platforms will be added later.</p>
            </div>
            <Button onClick={handleOpenIntegrationDialog} className="gap-2">
              <PlugZap className="h-4 w-4" />
              Connect
            </Button>
          </div>
        )}
      </div>

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

      <Dialog
        open={integrationDialogOpen}
        onOpenChange={(open) => {
          setIntegrationDialogOpen(open);
          if (!open) resetIntegrationDialog();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{integrationStep === "select" ? "Create Integration" : "Configure Integration"}</DialogTitle>
            <DialogDescription>
              {integrationStep === "select"
                ? "Choose your platform and continue to configuration. Only one connection is allowed at a time."
                : selectedProviderConfig?.description}
            </DialogDescription>
          </DialogHeader>

          {integrationStep === "select" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {INTEGRATION_PROVIDERS.map((provider) => (
                  <button
                    key={provider.value}
                    onClick={() => {
                      if (!provider.available) return;
                      setSelectedProvider(provider.value);
                      setIntegrationStep("configure");
                      setTestedConnection(null);
                    }}
                    disabled={!provider.available}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      provider.available
                        ? "border-border hover:border-primary/40"
                        : "opacity-50 cursor-not-allowed bg-muted/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-primary" />
                        <span className="font-semibold text-sm">{provider.label}</span>
                      </div>
                      {!provider.available && <Badge variant="secondary">Coming Soon</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{provider.description}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    setIntegrationStep("select");
                    setSelectedProvider(null);
                    setTestedConnection(null);
                    setIntegrationError("");
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span>{selectedProviderConfig?.label} Integration</span>
              </div>

              {selectedProvider === "shopify" && (
                <div className="rounded-xl border border-border/60 p-4 space-y-4 bg-muted/10">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Integration Name</Label>
                    <Input
                      name="integration-name"
                      autoComplete="off"
                      value={integrationName}
                      onChange={(e) => {
                        setIntegrationName(e.target.value);
                        setTestedConnection(null);
                      }}
                      placeholder="e.g. My Shopify Store"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">A friendly name to identify this integration.</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Store URL</Label>
                    <Input
                      name="shopify-store-url"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={storeUrl}
                      onChange={(e) => {
                        setStoreUrl(e.target.value);
                        setTestedConnection(null);
                      }}
                      placeholder="yourstore.myshopify.com"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Your Shopify store URL.</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Admin API Access Token</Label>
                    <Input
                      type="password"
                      name="shopify-admin-api-token"
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={adminApiToken}
                      onChange={(e) => {
                        setAdminApiToken(e.target.value);
                        setTestedConnection(null);
                      }}
                      placeholder="shpat_xxxxxxxxxxxx"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Generate this from Shopify admin under Apps → Develop apps.</p>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">Test Connection</p>
                      <p className="text-xs text-muted-foreground">Validate credentials before creating the integration.</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={testingConnection || !integrationName.trim() || !storeUrl.trim() || !adminApiToken.trim()}
                      className="gap-2"
                    >
                      {testingConnection && <Loader2 className="h-4 w-4 animate-spin" />}
                      Test Connection
                    </Button>
                  </div>

                  {testedConnection && (
                    <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-400">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Connection successful</span>
                      </div>
                      <p className="mt-1">Store: {testedConnection.accountLabel}</p>
                      {testedConnection.storeDomain && <p className="mt-1">Domain: {testedConnection.storeDomain}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {integrationStep === "configure" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIntegrationStep("select");
                    setSelectedProvider(null);
                    setTestedConnection(null);
                    setIntegrationError("");
                  }}
                >
                  Back
                </Button>
                <Button onClick={handleSaveIntegration} disabled={!testedConnection || savingIntegration} className="gap-2">
                  {savingIntegration ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Create Integration
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
