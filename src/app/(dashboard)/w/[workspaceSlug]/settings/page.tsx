"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
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
  testWorkspaceIntegration,
  saveWorkspaceIntegration,
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

type ConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required?: boolean;
  helpText?: string;
};

const INTEGRATION_PROVIDERS = [
  {
    value: "shopify" as const,
    label: "Shopify",
    description: "Configure your Shopify store connection",
    available: true,
    configFields: [
      { key: "store_url", label: "Store URL", type: "url" as const, placeholder: "yourstore.myshopify.com", required: true, helpText: "Your .myshopify.com domain." },
      { key: "admin_api_token", label: "Admin API Access Token", type: "password" as const, placeholder: "shpat_xxxxxxxxxxxx", required: true, helpText: "Generate from Shopify Admin → Apps → Develop apps → API credentials." },
    ] satisfies ConfigField[],
  },
  {
    value: "woocommerce" as const,
    label: "WooCommerce",
    description: "Configure your WooCommerce / WordPress store connection",
    available: true,
    configFields: [
      { key: "store_url", label: "Store URL", type: "url" as const, placeholder: "https://your-store.com", required: true, helpText: "Your WordPress site URL where WooCommerce is installed." },
      { key: "username", label: "WordPress Username", type: "text" as const, placeholder: "admin", required: true, helpText: "Your WordPress admin username." },
      { key: "application_password", label: "WordPress Application Password", type: "password" as const, placeholder: "xxxx xxxx xxxx xxxx xxxx xxxx", required: true, helpText: "Generate from WordPress → Users → Profile → Application Passwords. Do not use your normal login password." },
    ] satisfies ConfigField[],
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
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testingConnection, setTestingConnection] = useState(false);
  const [testedConnection, setTestedConnection] = useState<{ accountLabel: string; baseUrl: string; metadata?: Record<string, unknown> } | null>(null);
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
    setConfigValues({});
    setTestedConnection(null);
    setIntegrationError("");
  };

  const handleOpenIntegrationDialog = () => {
    resetIntegrationDialog();
    setIntegrationDialogOpen(true);
  };

  const handleTestConnection = async () => {
    if (!workspace || !selectedProvider) return;
    setIntegrationError("");
    setTestingConnection(true);
    try {
      const result = await testWorkspaceIntegration({
        workspaceId: workspace.id,
        provider: selectedProvider,
        integrationName,
        config: configValues,
      });
      setTestedConnection({
        accountLabel: result.accountLabel,
        baseUrl: result.baseUrl,
        metadata: result.metadata,
      });
    } catch (err: any) {
      setTestedConnection(null);
      setIntegrationError(err?.message || `Failed to test ${selectedProvider} connection`);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveIntegration = async () => {
    if (!workspace || !selectedProvider) return;
    setIntegrationError("");
    setSavingIntegration(true);
    try {
      const savedIntegration = await saveWorkspaceIntegration({
        workspaceId: workspace.id,
        provider: selectedProvider,
        integrationName,
        config: configValues,
      });
      setIntegration(savedIntegration);
      setIntegrationSuccess(`Connected to ${savedIntegration.integration_name}`);
      setIntegrationDialogOpen(false);
      resetIntegrationDialog();
    } catch (err: any) {
      setIntegrationError(err?.message || `Failed to save ${selectedProvider} integration`);
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
    <div className="autommerce-dashboard flex-1 overflow-auto bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-6 py-7">
          <motion.header
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                  <Settings className="h-4 w-4" />
                </span>
                <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                  Workspace
                </span>
              </div>
              <h1 className="text-3xl font-black tracking-[-0.035em] sm:text-4xl">
                Workspace
                <span className="block bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095] bg-clip-text pb-1 text-transparent">
                  settings.
                </span>
              </h1>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Manage workspace configuration for{" "}
                <span className="font-medium text-foreground">
                  {workspace.name}
                </span>
                .
              </p>
            </div>
            {permissions.canAdmin && (
              <Button
                size="sm"
                className="h-9 gap-1.5 self-start rounded-xl bg-[#400095] px-4 text-xs text-white shadow-[0_8px_24px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90 sm:self-auto"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save changes
              </Button>
            )}
          </motion.header>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {(error || integrationError || integrationSuccess || saved) && (
          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            {integrationError && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" /> {integrationError}
              </div>
            )}
            {integrationSuccess && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> {integrationSuccess}
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Saved successfully
              </div>
            )}
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Workspace",
              value: workspace.name,
              icon: Building2,
              style: "bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]",
            },
            {
              label: "CMS",
              value:
                CMS_TYPES.find((t) => t.value === cmsType)?.label || cmsType,
              icon: Globe,
              style: "bg-blue-500/10 text-blue-600",
            },
            {
              label: "Integration",
              value: integration ? "Connected" : "None",
              icon: PlugZap,
              style: integration
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-amber-500/10 text-amber-600",
            },
            {
              label: "Access",
              value: permissions.isOwner
                ? "Owner"
                : permissions.canAdmin
                  ? "Admin"
                  : "Member",
              icon: ShieldAlert,
              style: "bg-violet-500/10 text-violet-600",
            },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${stat.style}`}
              >
                <stat.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold leading-none">
                  {stat.value}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </motion.div>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          <div className="border-b bg-muted/20 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold">General</h2>
                <p className="text-[11px] text-muted-foreground">
                  Basic workspace information
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-4 p-5">
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
                className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
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
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                disabled={!permissions.canAdmin}
              />
            </div>

            {permissions.canAdmin && (
              <div className="flex items-center gap-3 border-t pt-4">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
          <div className="border-b bg-muted/20 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#400095]/10 text-[#6B358D] dark:bg-[#F76D01]/10 dark:text-[#F76D01]">
                <PlugZap className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold">Integrations</h2>
                <p className="text-[11px] text-muted-foreground">
                  Connect one store platform to this workspace
                </p>
              </div>
            </div>
          </div>
          <div className="p-5">
            {integrationLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading
                integration...
              </div>
            ) : integration ? (
              <div className="rounded-xl border bg-background p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Store className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" />
                      <span className="text-sm font-semibold">
                        {integration.integration_name}
                      </span>
                      <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">
                        Connected
                      </Badge>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5" />
                        <span className="font-medium text-foreground">
                          {connectedStoreDomain}
                        </span>
                      </p>
                      <p>Provider: {integration.provider}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleDisconnectIntegration}
                    disabled={disconnectingIntegration}
                    className="gap-2 self-start"
                  >
                    {disconnectingIntegration ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Link2Off className="h-4 w-4" />
                    )}
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start justify-between gap-4 rounded-xl border border-dashed bg-muted/10 p-5 sm:flex-row sm:items-center">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    No integration connected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Connect Shopify or WooCommerce to enable product sync.
                  </p>
                </div>
                <Button
                  onClick={handleOpenIntegrationDialog}
                  className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                >
                  <PlugZap className="h-4 w-4" />
                  Connect
                </Button>
              </div>
            )}
          </div>
        </section>

        {permissions.isOwner && (
          <section className="overflow-hidden rounded-2xl border border-destructive/30 bg-card shadow-sm">
            <div className="border-b border-destructive/20 bg-destructive/5 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <ShieldAlert className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-destructive">
                    Danger zone
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    Irreversible and destructive actions
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Deleting a workspace permanently removes all products,
                categories, imports, and files.{" "}
                <strong className="text-foreground">
                  This action cannot be undone.
                </strong>
              </p>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Type{" "}
                  <strong className="text-foreground">{workspace.name}</strong>{" "}
                  to confirm deletion
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
          </section>
        )}
      </div>

      <Dialog
        open={integrationDialogOpen}
        onOpenChange={(open) => {
          setIntegrationDialogOpen(open);
          if (!open) resetIntegrationDialog();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {integrationStep === "select"
                ? "Create Integration"
                : "Configure Integration"}
            </DialogTitle>
            <DialogDescription>
              {integrationStep === "select"
                ? "Choose your platform and continue to configuration. Only one connection is allowed at a time."
                : selectedProviderConfig?.description}
            </DialogDescription>
          </DialogHeader>

          {integrationStep === "select" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {INTEGRATION_PROVIDERS.map((provider) => (
                  <button
                    key={provider.value}
                    type="button"
                    onClick={() => {
                      if (!provider.available) return;
                      setSelectedProvider(provider.value);
                      setIntegrationStep("configure");
                      setTestedConnection(null);
                    }}
                    disabled={!provider.available}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      provider.available
                        ? "border-border hover:border-[#6B358D]/40 dark:hover:border-[#F76D01]/40"
                        : "cursor-not-allowed bg-muted/20 opacity-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Store className="h-4 w-4 text-[#6B358D] dark:text-[#F76D01]" />
                        <span className="text-sm font-semibold">
                          {provider.label}
                        </span>
                      </div>
                      {!provider.available && (
                        <Badge variant="secondary">Coming Soon</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {provider.description}
                    </p>
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

              {selectedProviderConfig && (
                <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">
                      Integration Name
                    </Label>
                    <Input
                      name="integration-name"
                      autoComplete="off"
                      value={integrationName}
                      onChange={(e) => {
                        setIntegrationName(e.target.value);
                        setTestedConnection(null);
                      }}
                      placeholder={`e.g. My ${selectedProviderConfig.label} Store`}
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">
                      A friendly name to identify this integration.
                    </p>
                  </div>

                  {selectedProviderConfig.configFields.map((field) => (
                    <div key={field.key} className="space-y-2">
                      <Label className="text-xs font-semibold">
                        {field.label}
                      </Label>
                      <Input
                        type={field.type === "password" ? "password" : "text"}
                        name={`${selectedProvider}-${field.key}`}
                        autoComplete={
                          field.type === "password" ? "new-password" : "off"
                        }
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={configValues[field.key] ?? ""}
                        onChange={(e) => {
                          setConfigValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }));
                          setTestedConnection(null);
                        }}
                        placeholder={field.placeholder}
                        className="h-10"
                      />
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">
                          {field.helpText}
                        </p>
                      )}
                    </div>
                  ))}

                  <div className="flex flex-col gap-4 rounded-xl border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Test Connection</p>
                      <p className="text-xs text-muted-foreground">
                        Validate credentials before creating the integration.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={
                        testingConnection ||
                        !integrationName.trim() ||
                        selectedProviderConfig.configFields.some(
                          (f) => f.required && !configValues[f.key]?.trim()
                        )
                      }
                      className="gap-2"
                    >
                      {testingConnection && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Test Connection
                    </Button>
                  </div>

                  {testedConnection && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Connection successful</span>
                      </div>
                      <p className="mt-1">
                        Store: {testedConnection.accountLabel}
                      </p>
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
                <Button
                  onClick={handleSaveIntegration}
                  disabled={!testedConnection || savingIntegration}
                  className="gap-2 rounded-xl bg-[#400095] text-white hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
                >
                  {savingIntegration ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
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
