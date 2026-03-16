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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockMatchingRules, mockMatchResults } from "../../../mock-data";

function ImportStepper({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Column Mapping" },
    { num: 2, label: "Matching Rules" },
    { num: 3, label: "Review Results" },
    { num: 4, label: "AI Enrichment" },
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

export default function DemoRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState(mockMatchingRules);
  const [matchColumn, setMatchColumn] = useState("sku");
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const toggleRule = (index: number) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], enabled: !updated[index].enabled };
    setRules(updated);
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    await new Promise((r) => setTimeout(r, 2000));
    setPreviewLoading(false);
    setShowPreview(true);
  };

  const handleContinue = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/demo/import/session/review");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configure how supplier SKUs are matched against your catalog</p>
      </div>

      <ImportStepper currentStep={2} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Rules Config */}
        <div className="lg:col-span-2 space-y-4">
          {/* Match Column */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Match Configuration
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Match Column</label>
                <select
                  value={matchColumn}
                  onChange={(e) => setMatchColumn(e.target.value)}
                  className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1"
                >
                  <option value="sku">SKU</option>
                  <option value="barcode">Barcode</option>
                  <option value="name">Product Name</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Category Filter (optional)</label>
                <select className="w-full h-8 px-2.5 text-xs rounded border bg-background mt-1">
                  <option value="">All Categories</option>
                  <option value="laptops">Laptops</option>
                  <option value="smartphones">Smartphones</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Rules List */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Matching Rules</h3>
            <p className="text-[10px] text-muted-foreground mb-4">
              Rules are applied in order to normalize SKU values before comparison. Enable the rules that match your supplier&apos;s format.
            </p>
            <div className="space-y-2">
              {rules.map((rule, index) => (
                <div
                  key={rule.type}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    rule.enabled ? "bg-primary/5 border-primary/20" : "bg-muted/30"
                  }`}
                >
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

          {/* Example */}
          <Card className="p-4 bg-muted/30">
            <h4 className="text-xs font-semibold mb-2">Live Preview</h4>
            <div className="text-[10px] space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28">Supplier SKU:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono">00LP-DELL-5520</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28">After rules:</span>
                <code className="bg-green-50 dark:bg-green-950/30 text-green-700 px-1.5 py-0.5 rounded font-mono">LP-DELL-5520</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28">Master SKU:</span>
                <code className="bg-muted px-1.5 py-0.5 rounded font-mono">LP-DELL-5520</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-28">Result:</span>
                <Badge variant="secondary" className="text-[9px] bg-green-50 dark:bg-green-950/30 text-green-700">
                  <Check className="h-2.5 w-2.5 mr-0.5" /> Match found
                </Badge>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: Preview Results */}
        <div className="space-y-4">
          <Button onClick={handlePreview} disabled={previewLoading} className="w-full gap-1.5 text-xs" variant="outline">
            {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {previewLoading ? "Running match..." : "Preview Match Results"}
          </Button>

          {showPreview && (
            <>
              <Card className="p-4 bg-green-50/50 dark:bg-green-950/10 border-green-200 dark:border-green-800">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{mockMatchResults.existing.length}</div>
                <div className="text-xs text-green-600">Existing (will update)</div>
              </Card>
              <Card className="p-4 bg-blue-50/50 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{mockMatchResults.new.length}</div>
                <div className="text-xs text-blue-600">New (need enrichment)</div>
              </Card>
              <Card className="p-4 bg-yellow-50/50 dark:bg-yellow-950/10 border-yellow-200 dark:border-yellow-800">
                <div className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">0</div>
                <div className="text-xs text-yellow-600">Ambiguous</div>
              </Card>

              {/* Sample matches */}
              <Card className="p-3">
                <h4 className="text-[10px] font-semibold text-muted-foreground uppercase mb-2">Sample Matches</h4>
                <div className="space-y-1.5">
                  {mockMatchResults.existing.slice(0, 3).map((m) => (
                    <div key={m.rowIndex} className="flex items-center gap-2 text-[10px]">
                      <code className="font-mono text-muted-foreground">{m.supplierSku}</code>
                      <ArrowRight className="h-2.5 w-2.5 text-green-500" />
                      <code className="font-mono text-green-600">{m.matchedSku}</code>
                    </div>
                  ))}
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
