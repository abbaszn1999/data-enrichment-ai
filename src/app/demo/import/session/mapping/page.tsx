"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeftRight,
  Sparkles,
  Check,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockSupplierColumns, mockSupplierRows } from "../../../mock-data";

const systemFields = [
  { value: "", label: "-- Skip (don't import) --" },
  { value: "sku", label: "SKU (Required)", required: true },
  { value: "name", label: "Product Name" },
  { value: "description", label: "Description" },
  { value: "price", label: "Price" },
  { value: "stock", label: "Stock / Quantity" },
  { value: "brand", label: "Brand" },
  { value: "category", label: "Category" },
  { value: "weight", label: "Weight" },
  { value: "dimensions", label: "Dimensions" },
  { value: "color", label: "Color / Variant" },
  { value: "image_url", label: "Image URL" },
  { value: "barcode", label: "Barcode / EAN" },
  { value: "custom", label: "+ Custom Field" },
];

const aiSuggestions: Record<string, { field: string; confidence: number }> = {
  "Part Number": { field: "sku", confidence: 95 },
  "Item Description": { field: "name", confidence: 88 },
  "Unit Cost": { field: "price", confidence: 92 },
  "QTY Available": { field: "stock", confidence: 90 },
  "Brand Name": { field: "brand", confidence: 97 },
  "Weight (kg)": { field: "weight", confidence: 85 },
};

// Stepper component
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
            {step.num < currentStep ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="text-[10px] font-bold">{step.num}</span>
            )}
            <span>{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`w-8 h-0.5 ${step.num < currentStep ? "bg-green-400" : "bg-muted"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export { ImportStepper };

export default function DemoMappingPage() {
  const router = useRouter();
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    mockSupplierColumns.forEach((col) => {
      m[col] = aiSuggestions[col]?.field || "";
    });
    return m;
  });
  const [showAiSuggestions, setShowAiSuggestions] = useState(true);
  const [loading, setLoading] = useState(false);

  const skuMapped = Object.values(mapping).includes("sku");

  const handleContinue = async () => {
    if (!skuMapped) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    router.push("/demo/import/session/rules");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Map supplier columns to your system fields</p>
      </div>

      <ImportStepper currentStep={1} />

      {/* AI Suggestion Banner */}
      {showAiSuggestions && (
        <Card className="p-3 bg-primary/5 border-primary/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium">AI auto-detected column mappings with high confidence</span>
          </div>
          <button onClick={() => setShowAiSuggestions(false)} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </Card>
      )}

      {/* SKU Warning */}
      {!skuMapped && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-medium">SKU column must be mapped to continue. This is used for matching against your master products.</span>
        </div>
      )}

      {/* Mapping Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-semibold w-1/3">Supplier Column</th>
              <th className="text-center px-4 py-2.5 w-10"></th>
              <th className="text-left px-4 py-2.5 font-semibold w-1/3">System Field</th>
              <th className="text-left px-4 py-2.5 font-semibold">Sample Values</th>
            </tr>
          </thead>
          <tbody>
            {mockSupplierColumns.map((col) => {
              const suggestion = aiSuggestions[col];
              const currentValue = mapping[col] || "";
              const isAiSuggested = suggestion && currentValue === suggestion.field;
              return (
                <tr key={col} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <span className="font-medium">{col}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={currentValue}
                        onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                        className={`h-8 flex-1 rounded border bg-background text-xs px-2 outline-none focus:ring-2 focus:ring-primary/50 ${
                          currentValue === "sku" ? "border-green-500 bg-green-50 dark:bg-green-950/20" : ""
                        }`}
                      >
                        {systemFields.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      {isAiSuggested && (
                        <Badge variant="secondary" className="text-[8px] gap-0.5 bg-primary/10 text-primary shrink-0">
                          <Sparkles className="h-2 w-2" />
                          AI {suggestion.confidence}%
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[10px] text-muted-foreground">
                    {mockSupplierRows.slice(0, 3).map((row, i) => (
                      <span key={i}>
                        {i > 0 && " | "}
                        {(row as Record<string, string>)[col]}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>
          Back
        </Button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {Object.values(mapping).filter(Boolean).length}/{mockSupplierColumns.length} columns mapped
          </span>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleContinue} disabled={!skuMapped || loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            {loading ? "Saving..." : "Continue to Matching Rules"}
          </Button>
        </div>
      </div>
    </div>
  );
}
