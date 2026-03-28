"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useWorkspaceContext } from "../../layout";
import { loadProductsJson, saveProductsJson, type MasterProductJson } from "@/lib/storage-helpers";
import { parseExcelFile } from "@/lib/excel";

function detectSkuColumn(columns: string[]): string | null {
  for (const col of columns) {
    const l = col.toLowerCase();
    if (l === "sku" || l.includes("item code") || l.includes("item_code") || l.includes("part") || l.includes("model")) return col;
  }
  return columns[0] || null;
}

export default function ProductUploadPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace } = useWorkspaceContext();

  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsedData, setParsedData] = useState<{ columns: string[]; rows: any[] } | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [skuColumn, setSkuColumn] = useState<string>("");
  const [dupMode, setDupMode] = useState<"skip" | "update" | "new">("skip");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: number; updated: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [quality, setQuality] = useState({ emptyRows: 0, emptyCells: 0, duplicateSkus: 0 });

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    try {
      const buffer = await selectedFile.arrayBuffer();
      const parsed = await parseExcelFile(buffer);
      if (parsed && parsed.rows.length > 0) {
        const columns = parsed.columns;
        const rows = parsed.rows;

        // Build preview
        const preview = rows.slice(0, 5).map((r) => {
          const obj: Record<string, string> = {};
          for (const col of columns) {
            obj[col] = r.originalData[col] ?? "";
          }
          return obj;
        });

        // Auto-detect SKU column
        const detectedSku = detectSkuColumn(columns);
        setSkuColumn(detectedSku || columns[0] || "");

        // Quality checks
        const emptyRows = rows.filter((r) => Object.values(r.originalData).every((v) => !v)).length;
        const emptyCells = rows.reduce((sum, r) => sum + columns.filter((c) => !r.originalData[c]).length, 0);
        const skus = detectedSku ? rows.map((r) => r.originalData[detectedSku]).filter(Boolean) : [];
        const duplicateSkus = skus.length - new Set(skus).size;

        setParsedData({ columns, rows: rows.map((r) => r.originalData) });
        setPreviewRows(preview);
        setQuality({ emptyRows, emptyCells, duplicateSkus });
        setStep(2);
      }
    } catch (err) {
      console.error("Parse error:", err);
      alert("Failed to parse file. Please check the format.");
    }
  };

  const handleImport = async () => {
    if (!workspace || !parsedData || !file || !skuColumn) return;
    setImporting(true);
    setProgress(0);

    try {
      // 1. Build products from parsed rows
      const newProducts: MasterProductJson[] = [];
      let emptySkuCount = 0;

      for (const row of parsedData.rows) {
        const sku = row[skuColumn];
        if (!sku) { emptySkuCount++; continue; }

        const data: Record<string, any> = {};
        for (const col of parsedData.columns) {
          data[col] = row[col] ?? "";
        }

        newProducts.push({ sku, data, status: "active", createdAt: new Date().toISOString() });
      }
      setProgress(30);

      // 2. Load existing products from Storage
      const existing = await loadProductsJson(workspace.id);
      const existingMap = new Map(existing.map((p) => [p.sku, p]));
      setProgress(50);

      // 3. Apply duplicate handling mode
      let imported = 0;
      let skippedCount = 0;
      let updatedCount = 0;
      const finalProducts = [...existing]; // Start with existing products

      if (dupMode === "skip") {
        // Skip Duplicates: only add products with NEW SKUs
        for (const p of newProducts) {
          if (existingMap.has(p.sku)) {
            skippedCount++;
          } else {
            finalProducts.push(p);
            imported++;
          }
        }
      } else if (dupMode === "update") {
        // Update Existing: overwrite data if SKU exists, add if new
        // Build a map from finalProducts for in-place updates
        const finalMap = new Map(finalProducts.map((p, i) => [p.sku, i]));
        for (const p of newProducts) {
          if (finalMap.has(p.sku)) {
            const idx = finalMap.get(p.sku)!;
            // Merge: new data overwrites old, keep enrichedData
            finalProducts[idx] = {
              ...finalProducts[idx],
              data: { ...finalProducts[idx].data, ...p.data },
            };
            updatedCount++;
          } else {
            finalProducts.push(p);
            imported++;
          }
        }
      } else if (dupMode === "new") {
        // Import as New: add all rows regardless of duplicates
        for (const p of newProducts) {
          if (existingMap.has(p.sku)) {
            // Add with a unique suffix to avoid overwriting
            finalProducts.push({ ...p, sku: `${p.sku}_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` });
          } else {
            finalProducts.push(p);
          }
          imported++;
        }
      }
      setProgress(80);

      // 4. Save to Storage
      await saveProductsJson(workspace.id, finalProducts);
      setProgress(100);

      setImportResult({ imported, skipped: emptySkuCount + skippedCount, errors: 0, updated: updatedCount });
      setStep(4);
    } catch (err: any) {
      alert(err?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Upload className="h-5 w-5" /> Upload Products
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Import your master product catalog</p>
        </div>
      </div>

      {/* Steps Indicator */}
      <div className="flex items-center gap-2">
        {["Upload", "Preview", "Import"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium ${
              step > i + 1 ? "bg-green-100 dark:bg-green-900/30 text-green-700" :
              step === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {step > i + 1 ? <CheckCircle2 className="h-3 w-3" /> : <span>{i + 1}</span>}
              <span>{s}</span>
            </div>
            {i < 2 && <div className={`w-6 h-0.5 ${step > i + 1 ? "bg-green-400" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <Card className="p-6">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".xlsx,.xls,.csv";
              input.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFileSelect(f); };
              input.click();
            }}
            className={`flex flex-col items-center justify-center gap-4 p-12 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
              isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
            }`}
          >
            <Upload className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">Drag & drop or click to browse</p>
              <p className="text-[10px] text-muted-foreground mt-1">.xlsx, .xls, .csv (max 50MB)</p>
            </div>
          </div>
        </Card>
      )}

      {/* Step 2: Preview + Quality */}
      {step === 2 && parsedData && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            <div>
              <div className="text-sm font-medium">{file?.name}</div>
              <div className="text-[10px] text-muted-foreground">{parsedData.rows.length} rows · {parsedData.columns.length} columns</div>
            </div>
          </div>

          {/* Quality Checks */}
          <Card className="p-4 space-y-2">
            <h3 className="text-xs font-semibold">Quality Checks</h3>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                {quality.emptyRows === 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                {quality.emptyRows === 0 ? "No empty rows" : `${quality.emptyRows} empty rows detected`}
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {quality.emptyCells === 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                {quality.emptyCells === 0 ? "No empty cells" : `${quality.emptyCells} empty cells found`}
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                {quality.duplicateSkus === 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                {quality.duplicateSkus === 0 ? "No duplicate SKUs" : `${quality.duplicateSkus} duplicate SKUs`}
              </div>
            </div>
          </Card>

          {/* Preview Table */}
          <Card className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-muted/50 border-b">
                  {parsedData.columns.map((col) => (
                    <th key={col} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-b">
                    {parsedData.columns.map((col) => (
                      <td key={col} className="px-3 py-1.5 whitespace-nowrap max-w-[150px] truncate">{row[col]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" size="sm" onClick={() => setStep(1)}>Back</Button>
            <Button size="sm" className="gap-1.5" onClick={() => setStep(3)}>
              Continue to Import <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Import */}
      {step === 3 && parsedData && (
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <h3 className="text-sm font-semibold">Import Settings</h3>

            <div className="space-y-3">
              <Label className="text-xs font-medium">SKU Column</Label>
              <select
                value={skuColumn}
                onChange={(e) => setSkuColumn(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {parsedData.columns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">Select the column that contains the unique product identifier (SKU)</p>
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-medium">Duplicate Handling</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "skip", label: "Skip Duplicates", desc: "Don't import if SKU exists" },
                  { value: "update", label: "Update Existing", desc: "Overwrite if SKU exists" },
                  { value: "new", label: "Import as New", desc: "Create duplicates" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDupMode(opt.value as any)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      dupMode === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="text-[11px] font-medium">{opt.label}</div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total rows</span><span className="font-medium">{parsedData.rows.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Columns</span><span className="font-medium">{parsedData.columns.length}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">SKU column</span><span className="font-medium">{skuColumn || "Not set"}</span></div>
            </div>

            {importing && (
              <div className="space-y-2">
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground text-center">
                  Importing... {progress}%
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setStep(2)} disabled={importing}>Back</Button>
              <Button size="sm" className="gap-1.5" onClick={handleImport} disabled={importing || !skuColumn}>
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importing ? "Importing..." : "Start Import"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Step 4: Result */}
      {step === 4 && importResult && (
        <Card className="p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h2 className="text-lg font-bold">Import Complete!</h2>
          <div className="grid grid-cols-4 gap-4 max-w-md mx-auto">
            <div>
              <div className="text-2xl font-bold text-green-600">{importResult.imported}</div>
              <div className="text-[10px] text-muted-foreground">New</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{importResult.updated}</div>
              <div className="text-[10px] text-muted-foreground">Updated</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-600">{importResult.skipped}</div>
              <div className="text-[10px] text-muted-foreground">Skipped</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{importResult.errors}</div>
              <div className="text-[10px] text-muted-foreground">Errors</div>
            </div>
          </div>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={() => { setStep(1); setFile(null); setParsedData(null); setImportResult(null); }}>
              Upload Another
            </Button>
            <Button onClick={() => router.push(`/w/${slug}/products`)}>
              View Products
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
