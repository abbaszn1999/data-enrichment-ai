"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { mockMatchingRules, mockMatchResults } from "../../../mock-data";

/* ── Multi-example preview data ────────────────────────── */

const liveExamples = [
  { supplier: "00LP-DELL-5520", after: "LP-DELL-5520", master: "LP-DELL-5520", match: true },
  { supplier: "00LP-HP-840G9", after: "LP-HP-840G9", master: "LP-HP-840G9", match: true },
  { supplier: "00PH-SAM-S24U", after: "PH-SAM-S24U", master: "PH-SAM-S24U", match: true },
  { supplier: "LP-MSI-RAID17", after: "LP-MSI-RAID17", master: null, match: false },
  { supplier: "PH-ONE-12PRO", after: "PH-ONE-12PRO", master: null, match: false },
];

const rulePresets = [
  { id: "samsung", name: "Samsung Format", description: "Prefix 00 + case insensitive", rules: ["trim_whitespace", "case_insensitive", "ignore_prefix"] },
  { id: "dell", name: "Dell Format", description: "Trim + case insensitive + strip dashes", rules: ["trim_whitespace", "case_insensitive", "strip_non_alnum"] },
  { id: "generic", name: "Generic / Safe", description: "Trim whitespace + case insensitive", rules: ["trim_whitespace", "case_insensitive"] },
];

/* ── Stepper ───────────────────────────────────────────── */

function ImportStepper({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Matching Rules" },
    { num: 2, label: "Review Results" },
    { num: 3, label: "Enrichment Tool" },
  ];
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((step, i) => (
        <div key={step.num} className="flex items-center gap-2">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            step.num === currentStep
              ? "bg-primary text-primary-foreground"
              : step.num < currentStep
              ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
              : "bg-muted text-muted-foreground"
          }`}>
            {step.num < currentStep ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{step.num}</span>}
            <span>{step.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`w-8 h-0.5 ${step.num < currentStep ? "bg-green-400" : "bg-muted"}`} />}
        </div>
      ))}
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────── */

export default function DemoRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState(mockMatchingRules);
  const [supplierMatchColumn, setSupplierMatchColumn] = useState("Part Number");
  const [masterMatchColumn, setMasterMatchColumn] = useState("sku");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testSku, setTestSku] = useState("");
  const [testResult, setTestResult] = useState<{ normalized: string; matched: boolean; matchedTo: string | null } | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>("samsung");

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
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    await new Promise((r) => setTimeout(r, 2000));
    setPreviewLoading(false);
    setShowPreview(true);
  };

  const handleTestSku = () => {
    if (!testSku.trim()) return;
    let normalized = testSku.trim();
    // Apply enabled rules
    if (rules.find((r) => r.type === "trim_whitespace" && r.enabled)) normalized = normalized.trim();
    if (rules.find((r) => r.type === "case_insensitive" && r.enabled)) normalized = normalized.toLowerCase();
    const prefix = rules.find((r) => r.type === "ignore_prefix" && r.enabled);
    if (prefix && prefix.value && normalized.toLowerCase().startsWith(prefix.value.toLowerCase())) {
      normalized = normalized.slice(prefix.value.length);
    }
    if (rules.find((r) => r.type === "strip_non_alnum" && r.enabled)) normalized = normalized.replace(/[^a-z0-9]/gi, "");

    // Check against master
    const masterSkus = ["LP-DELL-5520", "LP-HP-840G9", "PH-SAM-S24U", "LP-LEN-X1C10", "AC-ANK-PD65W"];
    const match = masterSkus.find((m) => m.toLowerCase() === normalized.toLowerCase() || m.toLowerCase() === normalized);
    setTestResult({ normalized: normalized.toUpperCase(), matched: !!match, matchedTo: match || null });
  };

  const handleContinue = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/demo/import/session/review");
  };

  const enabledRuleCount = rules.filter((r) => r.enabled).length;
  const matchRate = showPreview ? Math.round((mockMatchResults.existing.length / (mockMatchResults.existing.length + mockMatchResults.new.length)) * 100) : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configure how supplier SKUs are matched against your catalog</p>
      </div>

      <ImportStepper currentStep={1} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Rules Config — 2 cols */}
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
                  <option value="Part Number">Part Number</option>
                  <option value="Item Description">Item Description</option>
                  <option value="Unit Cost">Unit Cost</option>
                  <option value="QTY Available">QTY Available</option>
                  <option value="Brand Name">Brand Name</option>
                  <option value="Weight (kg)">Weight (kg)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Master Column</label>
                <select
                  value={masterMatchColumn}
                  onChange={(e) => setMasterMatchColumn(e.target.value)}
                  className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1"
                >
                  <option value="sku">SKU</option>
                  <option value="barcode">Barcode</option>
                  <option value="name">Product Name</option>
                </select>
              </div>
              <div className="relative">
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category Filter (optional)</label>
                <button
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                  className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1 text-left flex items-center justify-between"
                >
                  <span className={selectedCategories.length === 0 ? "text-muted-foreground" : ""}>
                    {selectedCategories.length === 0
                      ? "All Categories"
                      : `${selectedCategories.length} selected`}
                  </span>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
                {showCategoryDropdown && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowCategoryDropdown(false)} />
                    <div className="absolute top-full left-0 mt-1 w-full bg-popover border rounded-lg shadow-lg z-40 py-1 max-h-48 overflow-y-auto">
                      {["Laptops", "Smartphones", "Accessories", "Monitors", "Networking"].map((cat) => {
                        const isChecked = selectedCategories.includes(cat);
                        return (
                          <label
                            key={cat}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setSelectedCategories((prev) =>
                                  isChecked ? prev.filter((c) => c !== cat) : [...prev, cat]
                                );
                              }}
                              className="rounded border-muted-foreground/30"
                            />
                            {cat}
                          </label>
                        );
                      })}
                      {selectedCategories.length > 0 && (
                        <>
                          <div className="border-t my-1" />
                          <button
                            onClick={() => setSelectedCategories([])}
                            className="w-full px-3 py-1.5 text-[10px] text-left text-muted-foreground hover:bg-muted"
                          >
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
                    activePreset === preset.id
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "hover:bg-muted/50"
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
              Rules are applied in order to normalize SKU values before comparison. Drag to reorder.
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

          {/* Multi-Example Live Preview */}
          <Card className="p-4">
            <h4 className="text-xs font-semibold mb-3 flex items-center gap-2">
              <Eye className="h-3.5 w-3.5" /> Live Preview ({liveExamples.length} samples)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-2 py-1.5 font-semibold">Supplier SKU</th>
                    <th className="text-left px-2 py-1.5 font-semibold">After Rules</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Master SKU</th>
                    <th className="text-center px-2 py-1.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {liveExamples.map((ex, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-2 py-2 font-mono text-muted-foreground">{ex.supplier}</td>
                      <td className="px-2 py-2 font-mono font-medium">{ex.after}</td>
                      <td className="px-2 py-2 font-mono">
                        {ex.master ? (
                          <span className="text-green-600">{ex.master}</span>
                        ) : (
                          <span className="text-muted-foreground italic">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {ex.match ? (
                          <Badge variant="secondary" className="text-[8px] bg-green-50 text-green-700 dark:bg-green-950/30">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Match
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[8px] bg-blue-50 text-blue-700 dark:bg-blue-950/30">
                            New
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Test a SKU */}
          <Card className="p-4">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <FlaskConical className="h-3.5 w-3.5" /> Test a SKU
            </h4>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={testSku}
                onChange={(e) => { setTestSku(e.target.value); setTestResult(null); }}
                placeholder="Enter a supplier SKU to test..."
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
                    <Badge variant="secondary" className="text-[9px] bg-green-50 text-green-700 dark:bg-green-950/30">
                      <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Matched: {testResult.matchedTo}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px] bg-amber-50 text-amber-700 dark:bg-amber-950/30">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> No match found
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right: Preview Results — 1 col */}
        <div className="space-y-4">
          <Button onClick={handlePreview} disabled={previewLoading} className="w-full gap-1.5 text-xs" variant="outline">
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {previewLoading ? "Running match..." : "Preview Match Results"}
          </Button>

          {showPreview && (
            <>
              {/* Match Quality Score */}
              <Card className="p-4 text-center border-primary/20">
                <div className="text-3xl font-bold text-primary">{matchRate}%</div>
                <div className="text-xs text-muted-foreground mt-0.5">Match Quality Score</div>
                <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${matchRate}%` }} />
                </div>
              </Card>

              <Card className="p-4 bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-green-700 dark:text-green-400">{mockMatchResults.existing.length}</div>
                    <div className="text-xs text-green-600">Existing (will update)</div>
                  </div>
                  <TrendingUp className="h-5 w-5 text-green-500/40" />
                </div>
              </Card>
              <Card className="p-4 bg-blue-50/50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{mockMatchResults.new.length}</div>
                    <div className="text-xs text-blue-600">New (need enrichment)</div>
                  </div>
                  <Sparkles className="h-5 w-5 text-blue-500/40" />
                </div>
              </Card>
              <Card className="p-4 bg-yellow-50/50 dark:bg-yellow-950/10 border-yellow-200 dark:border-yellow-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">0</div>
                    <div className="text-xs text-yellow-600">Ambiguous</div>
                  </div>
                  <AlertTriangle className="h-5 w-5 text-yellow-500/40" />
                </div>
              </Card>

              {/* Before/After Stats */}
              <Card className="p-3">
                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Rule Impact</h4>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Without rules</span>
                    <span className="font-bold text-red-500">0 matches</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">With rules</span>
                    <span className="font-bold text-green-600">{mockMatchResults.existing.length} matches</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Improvement</span>
                    <span className="font-bold text-primary">+{mockMatchResults.existing.length} matches</span>
                  </div>
                </div>
              </Card>

              {/* Sample matches */}
              <Card className="p-3">
                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Sample Matches</h4>
                <div className="space-y-1.5">
                  {mockMatchResults.existing.map((m) => (
                    <div key={m.rowIndex} className="flex items-center gap-2 text-[10px]">
                      <code className="font-mono text-muted-foreground truncate flex-1">{m.supplierSku}</code>
                      <ArrowRight className="h-2.5 w-2.5 text-green-500 shrink-0" />
                      <code className="font-mono text-green-600 truncate flex-1">{m.matchedSku}</code>
                    </div>
                  ))}
                </div>
              </Card>

              {/* AI Suggestion */}
              <Card className="p-3 bg-primary/5 border-primary/20">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[10px] font-semibold">AI Suggestion</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">
                      Enabling &quot;Strip Non-Alphanumeric&quot; could improve matches by 15%. This supplier format often includes extra dashes.
                    </div>
                    <button className="text-[9px] text-primary font-medium mt-1 hover:underline">Apply suggestion</button>
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
          disabled={!showPreview || loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {loading ? "Processing..." : "Confirm & Review Results"}
        </Button>
      </div>
    </div>
  );
}
