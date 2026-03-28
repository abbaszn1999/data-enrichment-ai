"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  getImportSession,
  updateImportSession,
  type ImportSession,
} from "@/lib/supabase";
import { loadCategoriesJson, loadProductsJson, loadProjectJson, saveProjectJson, type CategoryJson, type MasterProductJson } from "@/lib/storage-helpers";
import { useWorkspaceContext } from "../../../layout";
import {
  DEFAULT_MATCHING_RULES,
  normalizeValue,
  generateDiff,
  type MatchingRule,
} from "@/lib/matching";
import { ImportStepper } from "@/components/import/import-stepper";

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

  useEffect(() => {
    if (!workspace || !sessionId) return;
    Promise.all([
      getImportSession(sessionId),
      loadCategoriesJson(workspace.id),
      loadProductsJson(workspace.id),
      loadProjectJson(workspace.id, sessionId),
    ]).then(([s, cats, prods, project]) => {
      // Extract unique data keys from master products as master columns
      const colSet = new Set<string>(["sku"]);
      for (const p of prods) {
        if (p.data) Object.keys(p.data).forEach((k) => colSet.add(k));
      }
      setMasterColumns(Array.from(colSet));
      setMasterProducts(prods);

      // Extract supplier columns from the project JSON
      if (project?.columns) {
        setSupplierColumns(project.columns);
        if (!supplierMatchColumn && project.columns.length > 0) {
          setSupplierMatchColumn(project.columns[0]);
        }
      }

      setSession(s);
      setCategories(cats);
      if (s) {
        if (s.matching_rules && (s.matching_rules as any[]).length > 0) {
          setRules(s.matching_rules as MatchingRule[]);
        }
        if (s.supplier_match_column) setSupplierMatchColumn(s.supplier_match_column);
        if (s.master_match_column) setMasterMatchColumn(s.master_match_column);
        if (s.target_category_ids) setSelectedCategories(s.target_category_ids);
      }
      setLoading(false);
    });
  }, [workspace, sessionId]);

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

  const handlePreview = async () => {
    if (!workspace || !sessionId) return;
    setPreviewLoading(true);
    try {
      const [project, prods] = await Promise.all([
        loadProjectJson(workspace.id, sessionId),
        loadProductsJson(workspace.id),
      ]);
      if (!project) { setPreviewLoading(false); return; }

      // Filter master products by selected categories if any
      const filteredProds = selectedCategories.length > 0
        ? prods.filter((p) => p.data?.CATEGORY && selectedCategories.some((catId) => {
            const cat = categories.find((c) => c.id === catId);
            return cat && String(p.data.CATEGORY).toLowerCase().includes(cat.name.toLowerCase());
          }))
        : prods;

      // Build a set of master product keys for comparison
      const masterKeys = new Set<string>();
      for (const p of filteredProds) {
        const val = masterMatchColumn === "sku" ? p.sku : (p.data?.[masterMatchColumn] ?? p.sku);
        masterKeys.add(normalizeValue(String(val), rules));
      }

      const containsRule = rules.find((r) => r.type === "contains" && r.enabled);
      let existing = 0;
      let newCount = 0;
      for (const row of project.rows) {
        const supplierVal = row.originalData?.[supplierMatchColumn] ?? "";
        const normalized = normalizeValue(String(supplierVal), rules);
        if (masterKeys.has(normalized)) {
          existing++;
        } else if (containsRule) {
          let found = false;
          for (const mk of masterKeys) {
            if (normalized.includes(mk) || mk.includes(normalized)) { found = true; break; }
          }
          if (found) existing++; else newCount++;
        } else {
          newCount++;
        }
      }

      setPreviewResult({ existing, new: newCount, ambiguous: 0 });
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

      // 3. Filter master products by selected categories if any
      const filteredProds = selectedCategories.length > 0
        ? prods.filter((p) => p.data?.CATEGORY && selectedCategories.some((catId) => {
            const cat = categories.find((c) => c.id === catId);
            return cat && String(p.data.CATEGORY).toLowerCase().includes(cat.name.toLowerCase());
          }))
        : prods;

      // Build master keys set
      const masterKeys = new Map<string, string>(); // normalized → original sku
      for (const p of filteredProds) {
        const val = masterMatchColumn === "sku" ? p.sku : (p.data?.[masterMatchColumn] ?? p.sku);
        const normalized = normalizeValue(String(val), rules);
        masterKeys.set(normalized, p.sku);
      }

      // Build master lookup for diff generation
      const masterMap = new Map(prods.map((p) => [p.sku, p]));
      const columnMapping: Record<string, string> = {};
      for (const col of project.columns) { columnMapping[col] = col; }
      const containsRule = rules.find((r) => r.type === "contains" && r.enabled);

      // 4. Match each row
      let existingCount = 0;
      let newCount = 0;

      for (const row of project.rows) {
        const supplierVal = row.originalData?.[supplierMatchColumn] ?? "";
        const normalized = normalizeValue(String(supplierVal), rules);

        let matchedSku: string | undefined;
        if (masterKeys.has(normalized)) {
          matchedSku = masterKeys.get(normalized);
        } else if (containsRule) {
          // Try contains match
          for (const [mk, sku] of masterKeys) {
            if (normalized.includes(mk) || mk.includes(normalized)) {
              matchedSku = sku;
              break;
            }
          }
        }

        if (matchedSku) {
          row.matchType = "existing";
          (row as any).matchedProductSku = matchedSku;
          const masterProduct = masterMap.get(matchedSku);
          if (masterProduct?.data && row.originalData) {
            (row as any).diffData = generateDiff(row.originalData, masterProduct.data, columnMapping);
          }
          existingCount++;
        } else {
          row.matchType = "new";
          newCount++;
        }
      }

      console.log("[Match] existing:", existingCount, "| new:", newCount, "| total:", project.rows.length);

      // 5. Save updated project back to Storage
      await saveProjectJson(workspace.id, session.id, project);

      // 6. Update session counts and status in DB
      await updateImportSession(session.id, {
        existing_count: existingCount,
        new_count: newCount,
        status: "review",
      } as any);

      router.push(`/w/${slug}/import/${session.id}/review`);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || err?.error_description || JSON.stringify(err);
      alert(msg || "Failed to run matching");
      setMatchLoading(false);
    }
  };

  const enabledRuleCount = rules.filter((r) => r.enabled).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
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
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{session.name}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Configure matching rules</p>
        </div>
      </div>

      <ImportStepper currentStep={2} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* Match Configuration */}
          <Card className="p-4">
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

          {/* Rule Presets */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5" /> Rule Presets
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {rulePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    activePreset === preset.id ? "border-primary/40 bg-primary/5 shadow-sm" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="text-[11px] font-medium">{preset.name}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">{preset.description}</div>
                </button>
              ))}
            </div>
          </Card>

          {/* Rules List */}
          <Card className="p-4">
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
                    rule.enabled ? "bg-primary/5 border-primary/20" : "bg-muted/30"
                  }`}
                >
                  <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 cursor-grab" />
                  <button
                    onClick={() => toggleRule(index)}
                    className={`h-5 w-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${
                      rule.enabled ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
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
          <Card className="p-4">
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
          <Button onClick={handlePreview} disabled={previewLoading} className="w-full gap-1.5 text-xs" variant="outline">
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {previewLoading ? "Running match..." : "Preview Match Results"}
          </Button>

          {showPreview && previewResult && (
            <>
              <Card className="p-4 text-center border-primary/20">
                <div className="text-3xl font-bold text-primary">
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
          className="gap-1.5 text-xs"
          onClick={handleContinue}
          disabled={matchLoading}
        >
          {matchLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {matchLoading ? "Running matching..." : "Confirm & Review Results"}
        </Button>
      </div>
    </div>
  );
}
