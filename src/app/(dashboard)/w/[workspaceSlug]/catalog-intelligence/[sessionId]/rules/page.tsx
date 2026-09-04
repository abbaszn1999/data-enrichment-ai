"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Loader2,
  Search,
  Eye,
  Settings2,
  AlertTriangle,
  GripVertical,
  Sparkles,
  Zap,
  BarChart3,
  X,
  CheckCircle2,
  FlaskConical,
  BookOpen,
  TrendingUp,
  ChevronDown,
  ArrowLeft,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/brand/page-loader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  getImportSession,
  updateImportSession,
  type ImportSession,
} from "@/lib/supabase";
import { loadCategoriesJson, loadProductsJson, loadProjectJson, saveProjectJson, type CategoryJson, type MasterProductJson, type ProjectRow } from "@/lib/storage-helpers";
import { useWorkspaceContext } from "../../../workspace-context";
import {
  DEFAULT_MATCHING_RULES,
  normalizeValue,
  generateDiff,
  type MatchingRule,
} from "@/lib/matching";
import { applyMatchTypes } from "@/lib/import-matching";
import { ImportStepper } from "@/components/catalog-intelligence/import-stepper";
import type { SessionKind } from "@/types";
import {
  countGroupedMatchTypes,
  resolveProductGroupColumn,
} from "@/lib/catalog/product-groups";

const rulePresets = [
  { id: "samsung", name: "Samsung Format", description: "Prefix 00 + case insensitive", rules: ["trim_whitespace", "case_insensitive", "ignore_prefix"] },
  { id: "dell", name: "Dell Format", description: "Trim + case insensitive + strip dashes", rules: ["trim_whitespace", "case_insensitive", "strip_non_alnum"] },
  { id: "generic", name: "Generic / Safe", description: "Trim whitespace + case insensitive", rules: ["trim_whitespace", "case_insensitive"] },
];

export default function MatchingRulesPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const sessionId = params.sessionId as string;
  const { workspace } = useWorkspaceContext();

  const [session, setSession] = useState<ImportSession | null>(null);
  const [categories, setCategories] = useState<CategoryJson[]>([]);
  const [rules, setRules] = useState<MatchingRule[]>(DEFAULT_MATCHING_RULES);
  const [supplierMatchColumn, setSupplierMatchColumn] = useState("");
  const [masterMatchColumn, setMasterMatchColumn] = useState("sku");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ existing: number; new: number; ambiguous: number } | null>(null);
  const [testSku, setTestSku] = useState("");
  const [testResult, setTestResult] = useState<{ normalized: string; matched: boolean; matchedWith?: string } | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [masterColumns, setMasterColumns] = useState<string[]>(["sku"]);
  const [supplierColumns, setSupplierColumns] = useState<string[]>([]);
  const [masterProducts, setMasterProducts] = useState<MasterProductJson[]>([]);
  const [kind, setKind] = useState<SessionKind>("product");
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([]);
  const [groupVariants, setGroupVariants] = useState(false);
  const [productGroupColumn, setProductGroupColumn] = useState("");

  useEffect(() => {
    if (!workspace || !sessionId) return;
    Promise.all([
      getImportSession(sessionId),
      loadCategoriesJson(workspace.id),
      loadProductsJson(workspace.id),
      loadProjectJson(workspace.id, sessionId),
    ]).then(async ([s, cats, prods, project]) => {
      const sessionKind: SessionKind =
        (s?.kind as SessionKind) ?? project?.kind ?? "product";

      // PLP has no matching step — categories are always matched
      // automatically. Any session that still lands here (e.g. an older
      // in-flight session) is bounced straight to Review instead.
      if (sessionKind === "plp") {
        if (s && workspace && project) {
          project.matchingSkipped = true;
          project.productGroupColumn = null;
          for (const row of project.rows) row.matchType = row.matchType ?? "new";
          await saveProjectJson(workspace.id, s.id, project);
          await updateImportSession(s.id, { status: "review" } as any).catch(() => {});
        }
        router.replace(`/w/${slug}/catalog-intelligence/${sessionId}/review`);
        return;
      }

      setKind(sessionKind);

      // Extract unique data keys from master products as master columns
      const colSet = new Set<string>(["sku"]);
      for (const p of prods) {
        if (p.data) Object.keys(p.data).forEach((k) => colSet.add(k));
      }
      setMasterColumns(Array.from(colSet));
      if (s?.master_match_column) setMasterMatchColumn(s.master_match_column);
      if (s?.matching_rules && (s.matching_rules as any[]).length > 0) {
        setRules(s.matching_rules as MatchingRule[]);
      }

      setMasterProducts(prods);

      // Extract supplier columns from the project JSON
      if (project?.columns) {
        setSupplierColumns(project.columns);
        setSupplierMatchColumn(s?.supplier_match_column || (project.columns[0] ?? ""));
      }
      if (project?.rows) setProjectRows(project.rows);

      const resolvedGroup = resolveProductGroupColumn({
        saved: project?.productGroupColumn,
        columns: project?.columns ?? [],
        rows: project?.rows ?? [],
        kind: sessionKind,
      });
      if (resolvedGroup) {
        setGroupVariants(true);
        setProductGroupColumn(resolvedGroup);
      } else {
        setGroupVariants(false);
        setProductGroupColumn(
          project?.columns?.find((col) => col.trim().toLowerCase() === "handle") ||
            project?.columns?.[0] ||
            ""
        );
      }

      setSession(s);
      setCategories(cats);
      if (s?.target_category_ids) setSelectedCategories(s.target_category_ids);
      setLoading(false);
    });
  }, [workspace, sessionId, router, slug]);

  const toggleRule = (index: number) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setRules(updated);
    setActivePreset(null);
  };

  const applyPreset = (preset: typeof rulePresets[0]) => {
    const updated = rules.map((r) => ({
      ...r,
      enabled: preset.rules.includes(r.type),
    }));
    setRules(updated);
    setActivePreset(preset.id);
    setShowPreview(false);
    setPreviewResult(null);
  };

  const handleTestSku = () => {
    if (!testSku.trim()) return;
    const normalized = normalizeValue(testSku.trim(), rules);

    // Actually check against master products
    const containsRule = rules.find((r) => r.type === "contains" && r.enabled);
    let matched = false;
    let matchedWith = "";
    for (const p of masterProducts) {
      const val = masterMatchColumn === "sku" ? p.sku : (p.data?.[masterMatchColumn] ?? p.sku);
      const masterNorm = normalizeValue(String(val), rules);
      if (masterNorm === normalized) {
        matched = true;
        matchedWith = String(val);
        break;
      }
      if (containsRule && (normalized.includes(masterNorm) || masterNorm.includes(normalized))) {
        matched = true;
        matchedWith = String(val);
        break;
      }
    }
    setTestResult({ normalized, matched, matchedWith });
  };

  /** Names of the categories the master catalog is narrowed to, if any. */
  const targetCategoryNames = selectedCategories
    .map((id) => categories.find((c) => c.id === id)?.name ?? "")
    .filter(Boolean);

  const handlePreview = async () => {
    if (!workspace || !sessionId) return;
    setPreviewLoading(true);
    try {
      const project = await loadProjectJson(workspace.id, sessionId);
      if (!project) { setPreviewLoading(false); return; }

      // Same helper the later steps use, so the preview cannot disagree with them.
      const previewRows = project.rows.map((r) => ({
        ...r,
        originalData: r.originalData,
      }));
      await applyMatchTypes({
        kind: "product",
        workspaceId: workspace.id,
        rows: previewRows,
        sourceColumn: supplierMatchColumn,
        masterColumn: masterMatchColumn,
        rules,
        targetCategoryNames,
      });

      const grouped = countGroupedMatchTypes(
        previewRows,
        groupVariants && productGroupColumn ? productGroupColumn : null
      );
      setPreviewResult({
        existing: grouped.existing,
        new: grouped.new,
        ambiguous: 0,
      });
      setShowPreview(true);
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!session || !workspace) return;
    setMatchLoading(true);

    try {
      // 1. Save rules to session DB
      await updateImportSession(session.id, {
        matching_rules: rules as any,
        supplier_match_column: supplierMatchColumn,
        master_match_column: masterMatchColumn,
        target_category_ids: selectedCategories,
      } as any);

      // 2. Load data client-side (same as handlePreview which works)
      const [project, prods] = await Promise.all([
        loadProjectJson(workspace.id, session.id),
        loadProductsJson(workspace.id),
      ]);

      if (!project || project.rows.length === 0) {
        throw new Error("No import rows found in storage.");
      }

      // 3. Match with the shared helper, then diff the rows it matched.
      await applyMatchTypes({
        kind: "product",
        workspaceId: workspace.id,
        rows: project.rows,
        sourceColumn: supplierMatchColumn,
        masterColumn: masterMatchColumn,
        rules,
        targetCategoryNames,
      });

      const masterMap = new Map(prods.map((p) => [p.sku, p]));
      const columnMapping: Record<string, string> = {};
      for (const col of project.columns) { columnMapping[col] = col; }

      for (const row of project.rows) {
        const matchedSku = (row as any).matchedProductSku as string | undefined;
        if (!matchedSku) continue;
        const masterProduct = masterMap.get(matchedSku);
        if (masterProduct?.data && row.originalData) {
          (row as any).diffData = generateDiff(
            row.originalData,
            masterProduct.data,
            columnMapping,
            masterMatchColumn
          );
        }
      }

      const groupColumn =
        groupVariants && productGroupColumn ? productGroupColumn : null;
      const grouped = countGroupedMatchTypes(project.rows, groupColumn);

      project.matchingSkipped = false;
      project.productGroupColumn = groupColumn;
      console.log("[Match] existing:", grouped.existing, "| new:", grouped.new, "| products:", grouped.products, "| rows:", grouped.rows);

      // 5. Save updated project back to Storage
      await saveProjectJson(workspace.id, session.id, project);

      // 6. Update session counts and status in DB
      await updateImportSession(session.id, {
        existing_count: grouped.existing,
        new_count: grouped.new,
        status: "review",
      } as any);

      router.push(`/w/${slug}/catalog-intelligence/${session.id}/review`);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || err?.error_description || JSON.stringify(err);
      alert(msg || "Failed to run matching");
      setMatchLoading(false);
    }
  };

  const enabledRuleCount = rules.filter((r) => r.enabled).length;

  if (loading) {
    return <PageLoader />;
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-muted-foreground">Session not found</p>
        <Button variant="outline" size="sm" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  return (
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="border-b border-border/60 bg-gradient-to-r from-[#400095]/[0.07] via-background to-[#F76D01]/[0.07]">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto flex max-w-[1500px] items-center gap-3 px-5 py-6 sm:px-7 lg:px-10">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="mb-1 text-[9px] font-black uppercase tracking-[.2em] text-[#400095] dark:text-[#F76D01]">
            Step 02 · Matching engine
          </div>
          <h1 className="text-2xl font-black tracking-tight">{session.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure how supplier identifiers map to your master catalog.
          </p>
        </div>
      </motion.div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-5 p-5 sm:p-7 lg:p-10">
      <section className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm"><ImportStepper currentStep={2} kind={kind} /></section>

      <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Match Configuration */}
          <Card className="rounded-2xl border-border/60 p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Match Configuration
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Supplier Column</label>
                <select
                  value={supplierMatchColumn}
                  onChange={(e) => setSupplierMatchColumn(e.target.value)}
                  className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1"
                >
                  {supplierColumns.map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Master Column</label>
                <select
                  value={masterMatchColumn}
                  onChange={(e) => setMasterMatchColumn(e.target.value)}
                  className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1"
                >
                  {masterColumns.map((col) => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category Filter (optional)</label>
                <button
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                  className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1 text-left flex items-center justify-between"
                >
                  <span className={selectedCategories.length === 0 ? "text-muted-foreground" : ""}>
                    {selectedCategories.length === 0 ? "All Categories" : `${selectedCategories.length} selected`}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
                {showCategoryDropdown && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowCategoryDropdown(false)} />
                    <div className="absolute top-full left-0 mt-1 w-full bg-popover border rounded-lg shadow-lg z-40 py-1 max-h-48 overflow-y-auto">
                      {categories.map((cat) => {
                        const isChecked = selectedCategories.includes(cat.id);
                        return (
                          <label key={cat.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedCategories((prev) =>
                                  isChecked ? prev.filter((c) => c !== cat.id) : [...prev, cat.id]
                                );
                              }}
                              className="rounded"
                            />
                            {cat.name}
                          </label>
                        );
                      })}
                      {selectedCategories.length > 0 && (
                        <>
                          <div className="border-t my-1" />
                          <button onClick={() => setSelectedCategories([])} className="w-full px-3 py-1.5 text-[10px] text-left text-muted-foreground hover:bg-muted">
                            Clear all
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>

          {kind !== "plp" && (
            <Card className="rounded-2xl border-border/60 p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4" /> Group product variants
              </h3>
              <label className="flex items-start gap-3 cursor-pointer">
                <button
                  type="button"
                  onClick={() => setGroupVariants((on) => !on)}
                  className={`mt-0.5 h-5 w-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                    groupVariants
                      ? "border-[#400095] bg-[#400095] text-white dark:border-[#F76D01] dark:bg-[#F76D01]"
                      : "border-muted-foreground/30"
                  }`}
                  aria-pressed={groupVariants}
                >
                  {groupVariants && <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">
                    One enrichment row per product
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                    Shopify-style files repeat Handle for each color, size, or image.
                    Enrichment will run once per product and copy the result onto the other rows so export stays complete.
                  </p>
                </div>
              </label>
              {groupVariants && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Product key column
                    </label>
                    <select
                      value={productGroupColumn}
                      onChange={(e) => setProductGroupColumn(e.target.value)}
                      className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1"
                    >
                      {supplierColumns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  {projectRows.length > 0 && productGroupColumn && (
                    <div className="flex items-end">
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        {(() => {
                          const stats = countGroupedMatchTypes(projectRows, productGroupColumn);
                          return `${stats.products.toLocaleString()} products from ${stats.rows.toLocaleString()} rows`;
                        })()}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Rule Presets */}
          <Card className="rounded-2xl border-border/60 p-5 shadow-sm">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5" /> Rule Presets
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {rulePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    activePreset === preset.id ? "border-[#400095]/40 bg-[#400095]/5 shadow-sm dark:border-[#F76D01]/40 dark:bg-[#F76D01]/5" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="text-[11px] font-medium">{preset.name}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{preset.description}</div>
                </button>
              ))}
            </div>
          </Card>

          {/* Rules List */}
          <Card className="rounded-2xl border-border/60 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Matching Rules</h3>
              <Badge variant="secondary" className="text-[9px]">{enabledRuleCount} active</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mb-4">
              Rules are applied in order to normalize SKU values before comparison.
            </p>
            <div className="space-y-2">
              {rules.map((rule, index) => (
                <div
                  key={rule.type}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    rule.enabled ? "border-[#400095]/20 bg-[#400095]/5 dark:border-[#F76D01]/20 dark:bg-[#F76D01]/5" : "bg-muted/30"
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 cursor-grab" />
                  <button
                    onClick={() => toggleRule(index)}
                    className={`h-5 w-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                      rule.enabled ? "border-[#400095] bg-[#400095] text-white dark:border-[#F76D01] dark:bg-[#F76D01]" : "border-muted-foreground/30"
                    }`}
                  >
                    {rule.enabled && <Check className="h-3 w-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{rule.label}</div>
                    <div className="text-[10px] text-muted-foreground">{rule.description}</div>
                  </div>
                  {(rule.type === "ignore_prefix" || rule.type === "ignore_suffix") && rule.enabled && (
                    <input
                      type="text"
                      value={rule.value || ""}
                      placeholder="e.g. 00"
                      onChange={(e) => {
                        const updated = [...rules];
                        updated[index] = { ...updated[index], value: e.target.value };
                        setRules(updated);
                      }}
                      className="h-7 w-20 px-2 text-xs rounded border bg-background"
                    />
                  )}
                  {rule.type === "regex_extract" && rule.enabled && (
                    <input
                      type="text"
                      value={rule.pattern || ""}
                      placeholder="e.g. \\d+"
                      onChange={(e) => {
                        const updated = [...rules];
                        updated[index] = { ...updated[index], pattern: e.target.value };
                        setRules(updated);
                      }}
                      className="h-7 w-32 px-2 text-xs rounded border bg-background font-mono"
                    />
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Test a SKU */}
          <Card className="rounded-2xl border-border/60 p-5 shadow-sm">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5" /> Test a Value
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={testSku}
                onChange={(e) => { setTestSku(e.target.value); setTestResult(null); }}
                placeholder="Enter a supplier value to test..."
                className="flex-1 h-8 px-2.5 text-xs rounded border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                onKeyDown={(e) => e.key === "Enter" && handleTestSku()}
              />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleTestSku}>
                <Search className="h-3 w-3" /> Test
              </Button>
            </div>
            {testResult && (
              <div className="mt-2 p-2.5 rounded-lg bg-muted/30 border space-y-1 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-24">Input:</span>
                  <code className="font-mono">{testSku}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-24">Normalized:</span>
                  <code className="font-mono font-medium">{testResult.normalized}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-24">Result:</span>
                  {testResult.matched ? (
                    <span className="text-green-600 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Match found{testResult.matchedWith ? ` → ${testResult.matchedWith}` : ""}
                    </span>
                  ) : (
                    <span className="text-red-500 font-medium flex items-center gap-1">
                      <X className="h-3 w-3" /> No match
                    </span>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right: Preview Results */}
        <div className="space-y-4">
          <Button onClick={handlePreview} disabled={previewLoading} className="h-10 w-full gap-1.5 rounded-xl border-[#6B358D]/25 text-xs" variant="outline">
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {previewLoading ? "Running match..." : "Preview Match Results"}
          </Button>

          {showPreview && previewResult && (
            <>
              <Card className="rounded-2xl border-[#6B358D]/20 bg-gradient-to-br from-[#400095]/5 to-[#F76D01]/5 p-5 text-center">
                <div className="text-3xl font-black text-[#400095] dark:text-[#F76D01]">
                  {previewResult.existing + previewResult.new > 0
                    ? Math.round((previewResult.existing / (previewResult.existing + previewResult.new)) * 100)
                    : 0}%
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Match Quality Score</div>
              </Card>

              <Card className="p-4 bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-800">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{previewResult.existing}</div>
                <div className="text-xs text-green-600">Existing (will update)</div>
              </Card>
              <Card className="p-4 bg-blue-50/50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{previewResult.new}</div>
                <div className="text-xs text-blue-600">New (need enrichment)</div>
              </Card>
              {previewResult.ambiguous > 0 && (
                <Card className="p-4 bg-yellow-50/50 dark:bg-yellow-950/10 border-yellow-200 dark:border-yellow-800">
                  <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{previewResult.ambiguous}</div>
                  <div className="text-xs text-yellow-600">Ambiguous</div>
                </Card>
              )}

              <Card className="p-3 bg-primary/5 border-primary/20">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-semibold">AI Suggestion</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Try enabling &quot;Strip Non-Alphanumeric&quot; to potentially improve match rate.
                    </div>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>Back</Button>
        <Button
          size="sm"
          className="h-9 gap-1.5 rounded-xl bg-[#400095] px-4 text-xs text-white hover:bg-[#6B358D] dark:bg-[#F76D01]"
          onClick={handleContinue}
          disabled={matchLoading}
        >
          {matchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {matchLoading ? "Running matching..." : "Confirm & Review Results"}
        </Button>
      </div>
      </>
      </main>
    </div>
  );
}
