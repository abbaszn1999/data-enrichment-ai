"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  X,
  Loader2,
  ArrowDown,
  Sparkles,
  SkipForward,
  CheckCircle2,
  RefreshCw,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockMatchResults, mockSupplierRows } from "../../../mock-data";

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

export default function DemoReviewPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
  const [existingActions, setExistingActions] = useState<Record<number, string>>({});
  const [updateFields, setUpdateFields] = useState({ price: true, stock: true });
  const [applyLoading, setApplyLoading] = useState(false);
  const [applied, setApplied] = useState(false);

  const handleApplyUpdates = async () => {
    setApplyLoading(true);
    await new Promise((r) => setTimeout(r, 2000));
    setApplyLoading(false);
    setApplied(true);
  };

  const handleGoToEnrich = () => {
    router.push("/demo/import/session/enrich");
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Review matching results and decide actions</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-[10px] bg-green-50 dark:bg-green-950/30 text-green-700 gap-1">
            <RefreshCw className="h-2.5 w-2.5" /> {mockMatchResults.existing.length} to update
          </Badge>
          <Badge variant="secondary" className="text-[10px] bg-blue-50 dark:bg-blue-950/30 text-blue-700 gap-1">
            <Plus className="h-2.5 w-2.5" /> {mockMatchResults.new.length} new products
          </Badge>
        </div>
      </div>

      <ImportStepper currentStep={3} />

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab("existing")}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "existing"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Existing Products ({mockMatchResults.existing.length})
        </button>
        <button
          onClick={() => setActiveTab("new")}
          className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === "new"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          New Products ({mockMatchResults.new.length})
        </button>
      </div>

      {/* Existing Products Tab - Diff View */}
      {activeTab === "existing" && (
        <div className="space-y-4">
          {/* Field filter */}
          <Card className="p-3 flex items-center gap-4">
            <span className="text-xs font-medium">Fields to update:</span>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={updateFields.price}
                onChange={(e) => setUpdateFields({ ...updateFields, price: e.target.checked })}
                className="rounded"
              />
              Price
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={updateFields.stock}
                onChange={(e) => setUpdateFields({ ...updateFields, stock: e.target.checked })}
                className="rounded"
              />
              Stock
            </label>
            <div className="flex-1" />
            <Button size="sm" variant="outline" className="text-[10px] h-7 gap-1" onClick={() => {
              const actions: Record<number, string> = {};
              mockMatchResults.existing.forEach((m) => { actions[m.rowIndex] = "update"; });
              setExistingActions(actions);
            }}>
              <Check className="h-3 w-3" /> Update All
            </Button>
            <Button size="sm" variant="outline" className="text-[10px] h-7 gap-1" onClick={() => {
              const actions: Record<number, string> = {};
              mockMatchResults.existing.forEach((m) => { actions[m.rowIndex] = "skip"; });
              setExistingActions(actions);
            }}>
              <SkipForward className="h-3 w-3" /> Skip All
            </Button>
          </Card>

          {/* Diff Table */}
          <Card className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-semibold">SKU</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Field</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Current Value</th>
                  <th className="text-center px-4 py-2.5 w-8"></th>
                  <th className="text-left px-4 py-2.5 font-semibold">New Value</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {mockMatchResults.existing.map((match) => {
                  const action = existingActions[match.rowIndex] || "pending";
                  return Object.entries(match.diff).map(([field, values], i) => (
                    <tr key={`${match.rowIndex}-${field}`} className={`border-b transition-colors ${
                      action === "skip" ? "opacity-40" : action === "update" ? "bg-green-50/30 dark:bg-green-950/10" : ""
                    }`}>
                      {i === 0 && (
                        <td className="px-4 py-2.5 font-mono text-[10px] font-medium" rowSpan={Object.keys(match.diff).length}>
                          {match.matchedSku}
                        </td>
                      )}
                      <td className="px-4 py-2.5 font-medium capitalize">{field}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-red-500 line-through">${values.old}</span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <ArrowRight className="h-3 w-3 text-muted-foreground mx-auto" />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-green-600 font-semibold">${values.new}</span>
                      </td>
                      {i === 0 && (
                        <td className="px-4 py-2.5 text-center" rowSpan={Object.keys(match.diff).length}>
                          <div className="flex items-center gap-1 justify-center">
                            <button
                              onClick={() => setExistingActions({ ...existingActions, [match.rowIndex]: "update" })}
                              className={`h-6 px-2 rounded text-[10px] font-medium transition-colors ${
                                action === "update"
                                  ? "bg-green-500 text-white"
                                  : "bg-muted text-muted-foreground hover:bg-green-100 hover:text-green-700"
                              }`}
                            >
                              Update
                            </button>
                            <button
                              onClick={() => setExistingActions({ ...existingActions, [match.rowIndex]: "skip" })}
                              className={`h-6 px-2 rounded text-[10px] font-medium transition-colors ${
                                action === "skip"
                                  ? "bg-gray-500 text-white"
                                  : "bg-muted text-muted-foreground hover:bg-gray-100 hover:text-gray-700"
                              }`}
                            >
                              Skip
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </Card>

          {/* Apply Button */}
          <div className="flex justify-end">
            {applied ? (
              <Badge className="bg-green-500 text-white text-xs gap-1 py-1.5 px-4">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {Object.values(existingActions).filter((a) => a === "update").length || mockMatchResults.existing.length} products updated successfully
              </Badge>
            ) : (
              <Button onClick={handleApplyUpdates} disabled={applyLoading} className="gap-1.5 text-xs">
                {applyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {applyLoading ? "Applying updates..." : `Apply ${Object.values(existingActions).filter((a) => a === "update").length || mockMatchResults.existing.length} Updates to Master`}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* New Products Tab */}
      {activeTab === "new" && (
        <div className="space-y-4">
          <Card className="p-4 bg-blue-50/30 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-blue-600" />
              <div>
                <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                  {mockMatchResults.new.length} new products detected
                </h3>
                <p className="text-[10px] text-blue-600 mt-0.5">
                  These products don&apos;t exist in your catalog. Use AI enrichment to generate titles, descriptions, and more before adding them.
                </p>
              </div>
              <div className="flex-1" />
              <Button onClick={handleGoToEnrich} className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700">
                <Sparkles className="h-3.5 w-3.5" /> Start AI Enrichment
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-semibold w-8"><input type="checkbox" className="rounded" /></th>
                  <th className="text-left px-4 py-2.5 font-semibold">SKU</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Description</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Brand</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Price</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Stock</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {mockMatchResults.new.map((item) => (
                  <tr key={item.rowIndex} className="border-b hover:bg-muted/20">
                    <td className="px-4 py-3"><input type="checkbox" className="rounded" defaultChecked /></td>
                    <td className="px-4 py-3 font-mono text-[10px]">{item.supplierSku}</td>
                    <td className="px-4 py-3">{item.data["Item Description"]}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.data["Brand Name"]}</td>
                    <td className="px-4 py-3 text-right font-mono">${item.data["Unit Cost"]}</td>
                    <td className="px-4 py-3 text-right font-mono">{item.data["QTY Available"]}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className="text-[9px]">Needs Enrichment</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>Back</Button>
        {activeTab === "existing" && applied && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setActiveTab("new")}>
            Continue to New Products <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
