"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  ArrowRight,
  ArrowLeftRight,
  Check,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const steps = ["Upload File", "Preview", "Map Columns", "Import"];

const sampleColumns = ["SKU", "Product Name", "Price", "Stock", "Brand", "Category", "Weight", "Description"];
const sampleRows = [
  { SKU: "LP-DELL-5520", "Product Name": "Dell Latitude 5520", Price: "1299.00", Stock: "45", Brand: "Dell", Category: "Laptops", Weight: "1.8", Description: "15.6in i7 16GB" },
  { SKU: "LP-HP-840G9", "Product Name": "HP EliteBook 840 G9", Price: "1450.00", Stock: "32", Brand: "HP", Category: "Laptops", Weight: "1.4", Description: "14in i5 8GB" },
  { SKU: "PH-SAM-S24U", "Product Name": "Samsung Galaxy S24 Ultra", Price: "1199.00", Stock: "67", Brand: "Samsung", Category: "Smartphones", Weight: "0.23", Description: "512GB Titanium" },
];

const systemFields = ["-- Skip --", "SKU (Required)", "Name", "Description", "Price", "Stock", "Brand", "Category", "Weight", "Dimensions", "Color", "Image URL", "Barcode"];

export default function DemoProductUploadPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importDone, setImportDone] = useState(false);

  const handleFileSelect = () => {
    setFileName("techstore_products_catalog.xlsx");
  };

  const handleImport = async () => {
    setImporting(true);
    for (let i = 0; i <= 100; i += 5) {
      await new Promise((r) => setTimeout(r, 100));
      setImportProgress(i);
    }
    setImporting(false);
    setImportDone(true);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Upload className="h-5 w-5" /> Upload Master Products
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Import your store&apos;s product catalog from Excel or CSV</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              i === currentStep ? "bg-primary text-primary-foreground" :
              i < currentStep ? "bg-green-100 dark:bg-green-900/30 text-green-700" : "bg-muted text-muted-foreground"
            }`}>
              {i < currentStep ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              <span>{step}</span>
            </div>
            {i < steps.length - 1 && <div className={`w-8 h-0.5 ${i < currentStep ? "bg-green-400" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {currentStep === 0 && (
        <Card className="p-6 space-y-4">
          <div
            onClick={handleFileSelect}
            className={`flex flex-col items-center justify-center gap-3 p-12 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
              fileName ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
            }`}
          >
            {fileName ? (
              <>
                <FileSpreadsheet className="h-12 w-12 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">{fileName}</span>
                <span className="text-[10px] text-muted-foreground">1,247 rows detected | 8 columns | Click to change</span>
              </>
            ) : (
              <>
                <Upload className="h-12 w-12 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Drag & drop or click to browse</span>
                <span className="text-[10px] text-muted-foreground/60">.xlsx, .xls, .csv</span>
              </>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(1)} disabled={!fileName}>
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2: Preview */}
      {currentStep === 1 && (
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">File Preview</h2>
          <div className="text-[10px] text-muted-foreground flex gap-4">
            <span>File: {fileName}</span>
            <span>Rows: 1,247</span>
            <span>Columns: {sampleColumns.length}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-muted/50">
                  {sampleColumns.map((col) => (
                    <th key={col} className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row, i) => (
                  <tr key={i} className="border-t">
                    {sampleColumns.map((col) => (
                      <td key={col} className="px-3 py-1.5 whitespace-nowrap">{(row as Record<string, string>)[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">Showing first 3 of 1,247 rows</p>
          <div className="flex justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(0)}>Back</Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(2)}>
              Continue to Mapping <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3: Column Mapping */}
      {currentStep === 2 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Map Columns to System Fields</h2>
            <Badge variant="secondary" className="text-[9px] gap-1 bg-primary/10 text-primary">
              <Sparkles className="h-2.5 w-2.5" /> AI auto-detected all mappings
            </Badge>
          </div>
          <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 dark:bg-green-950/20 text-green-700 text-[10px]">
            <Check className="h-3 w-3" /> SKU column detected and mapped
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2 font-semibold">File Column</th>
                  <th className="text-center px-4 py-2 w-8"></th>
                  <th className="text-left px-4 py-2 font-semibold">System Field</th>
                </tr>
              </thead>
              <tbody>
                {sampleColumns.map((col) => (
                  <tr key={col} className="border-b">
                    <td className="px-4 py-2 font-medium">{col}</td>
                    <td className="px-4 py-2 text-center"><ArrowLeftRight className="h-3 w-3 text-muted-foreground mx-auto" /></td>
                    <td className="px-4 py-2">
                      <select className="h-7 w-full rounded border bg-background text-xs px-2" defaultValue={col === "Product Name" ? "Name" : col === "SKU" ? "SKU (Required)" : col}>
                        {systemFields.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(1)}>Back</Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(3)}>
              Start Import <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4: Import */}
      {currentStep === 3 && (
        <Card className="p-6 space-y-5">
          {!importDone && !importing && (
            <div className="text-center space-y-4">
              <h2 className="text-sm font-semibold">Ready to Import</h2>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>1,247 products will be imported into your master catalog.</p>
                <p>8 columns mapped to system fields.</p>
                <p>Original file will be saved to workspace storage.</p>
              </div>
              <Button onClick={handleImport} className="gap-1.5 text-xs">
                <Upload className="h-3.5 w-3.5" /> Import 1,247 Products
              </Button>
            </div>
          )}

          {importing && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs font-medium">Importing products...</span>
                <span className="text-xs font-bold text-primary ml-auto">{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-2" />
              <p className="text-[10px] text-muted-foreground text-center">
                {Math.round(1247 * importProgress / 100)}/1,247 products imported
              </p>
            </div>
          )}

          {importDone && (
            <div className="text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                <Check className="h-6 w-6 text-green-600" />
              </div>
              <h2 className="text-sm font-semibold text-green-700 dark:text-green-400">Import Complete!</h2>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>1,247 products imported successfully</p>
                <p>0 duplicates skipped</p>
                <p>0 errors</p>
              </div>
              <Button onClick={() => router.push("/demo/products")} className="gap-1.5 text-xs">
                View Products <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
