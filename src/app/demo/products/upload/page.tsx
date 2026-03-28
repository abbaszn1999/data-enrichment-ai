"use client";

import React, { useState, useEffect } from "react";
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
  Download,
  Clock,
  Hash,
  Type,
  FileText,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Copy,
  SkipForward,
  Replace,
  Package,
  Store,
  Columns,
  Shield,
  Timer,
  FileDown,
  RotateCcw,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

const steps = ["Upload File", "Preview", "Map Columns", "Import"];

/* ── Mock Data ─────────────────────────────────────────── */

const sampleColumns = ["SKU", "Product Name", "Price", "Stock", "Brand", "Category", "Weight", "Description"];

const sampleRows = [
  { SKU: "LP-DELL-5520", "Product Name": "Dell Latitude 5520", Price: "1299.00", Stock: "45", Brand: "Dell", Category: "Laptops", Weight: "1.8", Description: "15.6in i7 16GB RAM 512GB SSD" },
  { SKU: "LP-HP-840G9", "Product Name": "HP EliteBook 840 G9", Price: "1450.00", Stock: "32", Brand: "HP", Category: "Laptops", Weight: "1.4", Description: "14in i5 8GB RAM 256GB SSD" },
  { SKU: "PH-SAM-S24U", "Product Name": "Samsung Galaxy S24 Ultra", Price: "1199.00", Stock: "67", Brand: "Samsung", Category: "Smartphones", Weight: "0.23", Description: "512GB Titanium Black" },
  { SKU: "PH-APL-15PM", "Product Name": "Apple iPhone 15 Pro Max", Price: "1399.00", Stock: "89", Brand: "Apple", Category: "Smartphones", Weight: "0.22", Description: "256GB Natural Titanium" },
  { SKU: "LP-LEN-T14G4", "Product Name": "Lenovo ThinkPad T14 Gen 4", Price: "1120.00", Stock: "28", Brand: "Lenovo", Category: "Laptops", Weight: "1.4", Description: "14in i5 16GB 512GB" },
  { SKU: "TB-SAM-S9FE", "Product Name": "Samsung Galaxy Tab S9 FE", Price: "449.00", Stock: "54", Brand: "Samsung", Category: "Tablets", Weight: "0.52", Description: "10.9in 128GB WiFi" },
  { SKU: "AC-ANK-735", "Product Name": "Anker 735 Charger 65W", Price: "45.99", Stock: "210", Brand: "Anker", Category: "Chargers & Cables", Weight: "0.12", Description: "GaN 3-port USB-C PD" },
  { SKU: "", "Product Name": "Generic USB-C Cable 2m", Price: "12.99", Stock: "500", Brand: "", Category: "Chargers & Cables", Weight: "0.05", Description: "" },
  { SKU: "HP-DYS-V15", "Product Name": "Dyson V15 Detect", Price: "749.00", Stock: "15", Brand: "Dyson", Category: "", Weight: "2.74", Description: "Cordless Vacuum Cleaner" },
  { SKU: "LP-DELL-5520", "Product Name": "Dell Latitude 5520 (Duplicate)", Price: "1299.00", Stock: "45", Brand: "Dell", Category: "Laptops", Weight: "1.8", Description: "15.6in i7 16GB" },
];

const sampleSheets = [
  { name: "Products", rows: 1247, cols: 8 },
  { name: "Categories", rows: 34, cols: 3 },
  { name: "Brands", rows: 18, cols: 2 },
];

const recentUploads = [
  { name: "techstore_q4_update.xlsx", date: "2 days ago", rows: 342 },
  { name: "samsung_new_arrivals.csv", date: "1 week ago", rows: 87 },
  { name: "accessories_bulk.xlsx", date: "2 weeks ago", rows: 1560 },
];

const columnTypes: Record<string, { type: "number" | "text" | "id"; icon: typeof Hash }> = {
  SKU: { type: "id", icon: Hash },
  "Product Name": { type: "text", icon: Type },
  Price: { type: "number", icon: Hash },
  Stock: { type: "number", icon: Hash },
  Brand: { type: "text", icon: Type },
  Category: { type: "text", icon: Type },
  Weight: { type: "number", icon: Hash },
  Description: { type: "text", icon: FileText },
};

const systemFields = [
  { value: "skip", label: "-- Skip --", required: false },
  { value: "sku", label: "SKU (Required)", required: true },
  { value: "name", label: "Name (Required)", required: true },
  { value: "description", label: "Description", required: false },
  { value: "price", label: "Price (Required)", required: true },
  { value: "stock", label: "Stock", required: false },
  { value: "brand", label: "Brand", required: false },
  { value: "category", label: "Category", required: false },
  { value: "weight", label: "Weight", required: false },
  { value: "dimensions", label: "Dimensions", required: false },
  { value: "color", label: "Color", required: false },
  { value: "image_url", label: "Image URL", required: false },
  { value: "barcode", label: "Barcode / EAN", required: false },
  { value: "tags", label: "Tags", required: false },
  { value: "body_html", label: "Body HTML (Shopify)", required: false },
  { value: "vendor", label: "Vendor (Shopify)", required: false },
  { value: "product_type", label: "Product Type (Shopify)", required: false },
];

interface ColumnMapping {
  fileCol: string;
  systemField: string;
  confidence: number;
  transform: string;
  sampleValues: string[];
}

const defaultMappings: ColumnMapping[] = [
  { fileCol: "SKU", systemField: "sku", confidence: 99, transform: "none", sampleValues: ["LP-DELL-5520", "LP-HP-840G9", "PH-SAM-S24U"] },
  { fileCol: "Product Name", systemField: "name", confidence: 96, transform: "none", sampleValues: ["Dell Latitude 5520", "HP EliteBook 840 G9", "Samsung Galaxy S24 Ultra"] },
  { fileCol: "Price", systemField: "price", confidence: 99, transform: "none", sampleValues: ["1299.00", "1450.00", "1199.00"] },
  { fileCol: "Stock", systemField: "stock", confidence: 95, transform: "none", sampleValues: ["45", "32", "67"] },
  { fileCol: "Brand", systemField: "brand", confidence: 97, transform: "none", sampleValues: ["Dell", "HP", "Samsung"] },
  { fileCol: "Category", systemField: "category", confidence: 92, transform: "none", sampleValues: ["Laptops", "Laptops", "Smartphones"] },
  { fileCol: "Weight", systemField: "weight", confidence: 72, transform: "none", sampleValues: ["1.8", "1.4", "0.23"] },
  { fileCol: "Description", systemField: "description", confidence: 88, transform: "none", sampleValues: ["15.6in i7 16GB RAM 512GB SSD", "14in i5 8GB RAM 256GB SSD", "512GB Titanium Black"] },
];

/* ── Quality Analysis (mock) ───────────────────────────── */

const qualityStats = {
  totalRows: 1247,
  totalColumns: 8,
  emptyRequired: 23,
  invalidData: 5,
  duplicates: 12,
  emptyOptional: 87,
  encoding: "UTF-8",
  headerRow: 1,
};

/* ── Component ─────────────────────────────────────────── */

export default function DemoProductUploadPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1 state
  const [fileName, setFileName] = useState("");
  const [selectedSheet, setSelectedSheet] = useState("Products");

  // Step 2 state
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewRows, setPreviewRows] = useState(10);

  // Step 3 state
  const [mappings, setMappings] = useState<ColumnMapping[]>(defaultMappings);
  const [showSamples, setShowSamples] = useState<Set<string>>(new Set());

  // Step 4 state
  const [duplicateMode, setDuplicateMode] = useState<"skip" | "update" | "import_new">("skip");
  const [matchBy, setMatchBy] = useState("sku");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [lastImported, setLastImported] = useState("");
  const [importStartTime, setImportStartTime] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Timer during import
  useEffect(() => {
    if (!importing) return;
    const interval = setInterval(() => setElapsed(Date.now() - importStartTime), 200);
    return () => clearInterval(interval);
  }, [importing, importStartTime]);

  const handleFileSelect = () => {
    setFileName("techstore_products_catalog.xlsx");
  };

  const handleImport = async () => {
    setImporting(true);
    setImportStartTime(Date.now());
    const names = sampleRows.map((r) => r["Product Name"]);
    for (let i = 0; i <= 100; i += 2) {
      await new Promise((r) => setTimeout(r, 80));
      setImportProgress(i);
      setLastImported(names[i % names.length]);
    }
    setImporting(false);
    setImportDone(true);
  };

  const updateMapping = (fileCol: string, field: string, value: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.fileCol === fileCol ? { ...m, [field]: value } : m))
    );
  };

  const toggleSamples = (col: string) => {
    setShowSamples((prev) => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  const filteredPreviewRows = sampleRows.filter((row) => {
    if (!previewSearch) return true;
    const s = previewSearch.toLowerCase();
    return Object.values(row).some((v) => v.toLowerCase().includes(s));
  });

  const unmappedRequired = systemFields
    .filter((sf) => sf.required && !mappings.some((m) => m.systemField === sf.value))
    .map((sf) => sf.label);

  const confidenceColor = (c: number) =>
    c >= 90 ? "text-green-600" : c >= 70 ? "text-amber-600" : "text-red-600";
  const confidenceBg = (c: number) =>
    c >= 90 ? "bg-green-50 dark:bg-green-950/20" : c >= 70 ? "bg-amber-50 dark:bg-amber-950/20" : "bg-red-50 dark:bg-red-950/20";

  const remainingSeconds = importing && importProgress > 0
    ? Math.round(((elapsed / importProgress) * (100 - importProgress)) / 1000)
    : 0;

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
            <button
              onClick={() => i < currentStep && setCurrentStep(i)}
              disabled={i > currentStep}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === currentStep ? "bg-primary text-primary-foreground" :
                i < currentStep ? "bg-green-100 dark:bg-green-900/30 text-green-700 cursor-pointer hover:bg-green-200 dark:hover:bg-green-900/50" :
                "bg-muted text-muted-foreground"
              }`}
            >
              {i < currentStep ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              <span>{step}</span>
            </button>
            {i < steps.length - 1 && <div className={`w-8 h-0.5 ${i < currentStep ? "bg-green-400" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════
          STEP 1: UPLOAD FILE
         ═══════════════════════════════════════════════════ */}
      {currentStep === 0 && (
        <div className="space-y-4">
          <Card className="p-6 space-y-4">
            {/* Drop Zone */}
            <div
              onClick={handleFileSelect}
              className={`flex flex-col items-center justify-center gap-3 p-10 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                fileName ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              {fileName ? (
                <>
                  <FileSpreadsheet className="h-10 w-10 text-green-600" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">{fileName}</span>
                  <span className="text-[10px] text-muted-foreground">Click to change file</span>
                </>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Drag & drop or click to browse</span>
                  <span className="text-[10px] text-muted-foreground/60">Supported: .xlsx, .xls, .csv (max 50MB)</span>
                </>
              )}
            </div>

            {/* File Stats (shown after upload) */}
            {fileName && (
              <div className="space-y-3">
                {/* Quick Stats */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-lg font-bold">1,247</div>
                    <div className="text-[10px] text-muted-foreground">Total Rows</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-lg font-bold">8</div>
                    <div className="text-[10px] text-muted-foreground">Columns</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-lg font-bold">2.4 MB</div>
                    <div className="text-[10px] text-muted-foreground">File Size</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <div className="text-lg font-bold">UTF-8</div>
                    <div className="text-[10px] text-muted-foreground">Encoding</div>
                  </div>
                </div>

                {/* Sheet Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Select Sheet</label>
                  <div className="flex gap-2">
                    {sampleSheets.map((sheet) => (
                      <button
                        key={sheet.name}
                        onClick={() => setSelectedSheet(sheet.name)}
                        className={`flex-1 p-2.5 rounded-lg border text-left transition-all ${
                          selectedSheet === sheet.name
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border/50 hover:border-primary/30"
                        }`}
                      >
                        <div className="text-xs font-semibold">{sheet.name}</div>
                        <div className="text-[10px] text-muted-foreground">{sheet.rows} rows · {sheet.cols} cols</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Header Row Detection */}
                <div className="flex items-center gap-3 p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200/50 dark:border-blue-800/30">
                  <Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <span className="text-[10px] text-blue-700 dark:text-blue-400">
                    Header row auto-detected at <span className="font-bold">Row 1</span>. Column names: SKU, Product Name, Price, Stock, Brand, Category, Weight, Description
                  </span>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /> Download Template
              </Button>
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(1)} disabled={!fileName}>
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </Card>

          {/* Recent Uploads */}
          <Card className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">Recent Uploads</span>
            </div>
            <div className="space-y-1">
              {recentUploads.map((file) => (
                <button
                  key={file.name}
                  onClick={handleFileSelect}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">{file.name}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{file.rows} rows</Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{file.date}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          STEP 2: PREVIEW
         ═══════════════════════════════════════════════════ */}
      {currentStep === 1 && (
        <div className="space-y-4">
          {/* Data Quality Summary Cards */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="h-3 w-3 text-green-600" />
                </div>
                <span className="text-lg font-bold">{qualityStats.totalRows}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Total Rows</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-5 w-5 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                </div>
                <span className="text-lg font-bold text-amber-600">{qualityStats.emptyRequired}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Missing Required</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-5 w-5 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <AlertCircle className="h-3 w-3 text-red-600" />
                </div>
                <span className="text-lg font-bold text-red-600">{qualityStats.invalidData}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Invalid Data</div>
            </Card>
            <Card className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-5 w-5 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Copy className="h-3 w-3 text-purple-600" />
                </div>
                <span className="text-lg font-bold text-purple-600">{qualityStats.duplicates}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">Duplicates Found</div>
            </Card>
          </div>

          {/* Warning Bar */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50/80 dark:bg-amber-950/10 border border-amber-200/60 dark:border-amber-800/30">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-[10px] text-amber-700 dark:text-amber-400 space-y-0.5">
              <p className="font-semibold">Issues detected in your file:</p>
              <p>• {qualityStats.emptyRequired} rows have empty SKU — these will be auto-generated during import</p>
              <p>• {qualityStats.invalidData} rows have non-numeric values in Price column</p>
              <p>• {qualityStats.duplicates} duplicate SKUs found (same SKU in multiple rows)</p>
            </div>
          </div>

          {/* Preview Table */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Data Preview</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                  <input
                    type="text"
                    placeholder="Search data..."
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="h-7 w-48 pl-7 pr-3 text-[10px] rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <select
                  value={previewRows}
                  onChange={(e) => setPreviewRows(Number(e.target.value))}
                  className="h-7 rounded-md border bg-background text-[10px] px-2"
                >
                  <option value={5}>5 rows</option>
                  <option value={10}>10 rows</option>
                  <option value={25}>25 rows</option>
                </select>
              </div>
            </div>

            {/* Column Types Legend */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="font-medium">Column types:</span>
              <span className="flex items-center gap-1"><Hash className="h-2.5 w-2.5 text-blue-500" /> Numeric</span>
              <span className="flex items-center gap-1"><Type className="h-2.5 w-2.5 text-green-500" /> Text</span>
              <span className="flex items-center gap-1"><Hash className="h-2.5 w-2.5 text-purple-500" /> ID</span>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground w-8">#</th>
                    {sampleColumns.map((col) => {
                      const ct = columnTypes[col];
                      const IconComp = ct?.icon || Type;
                      const color = ct?.type === "number" ? "text-blue-500" : ct?.type === "id" ? "text-purple-500" : "text-green-500";
                      return (
                        <th key={col} className="text-left px-3 py-1.5 font-semibold whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <IconComp className={`h-3 w-3 ${color}`} />
                            {col}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredPreviewRows.slice(0, previewRows).map((row, i) => {
                    const hasEmpty = !row.SKU || !row["Product Name"];
                    const isDuplicate = i === 9; // mock: last row is duplicate
                    return (
                      <tr
                        key={i}
                        className={`border-t ${
                          isDuplicate ? "bg-purple-50/50 dark:bg-purple-950/10" :
                          hasEmpty ? "bg-amber-50/50 dark:bg-amber-950/10" : ""
                        }`}
                      >
                        <td className="px-2 py-1.5 text-center text-muted-foreground font-mono">{i + 1}</td>
                        {sampleColumns.map((col) => {
                          const val = (row as Record<string, string>)[col];
                          const isEmpty = val === "" || val === undefined;
                          return (
                            <td key={col} className="px-3 py-1.5 whitespace-nowrap">
                              {isEmpty ? (
                                <span className="text-amber-500 italic">empty</span>
                              ) : isDuplicate && col === "SKU" ? (
                                <span className="text-purple-600 font-medium">{val} <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-purple-100 text-purple-700 ml-1">DUP</Badge></span>
                              ) : (
                                val
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              Showing {Math.min(previewRows, filteredPreviewRows.length)} of {qualityStats.totalRows} rows
              {previewSearch && ` (filtered)`}
            </p>
          </Card>

          <div className="flex justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(0)}>Back</Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(2)}>
              Continue to Mapping <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          STEP 3: COLUMN MAPPING
         ═══════════════════════════════════════════════════ */}
      {currentStep === 2 && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Map Columns to System Fields</h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">AI has auto-detected mappings. Review and adjust as needed.</p>
            </div>
            <Badge variant="secondary" className="text-[9px] gap-1 bg-primary/10 text-primary">
              <Sparkles className="h-2.5 w-2.5" /> AI auto-mapped 8/8 columns
            </Badge>
          </div>

          {/* CMS Required Fields Warning */}
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50/80 dark:bg-blue-950/10 border border-blue-200/60 dark:border-blue-800/30">
            <Store className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div className="text-[10px] text-blue-700 dark:text-blue-400">
              <p className="font-semibold">Platform: Shopify</p>
              <p>Required fields: SKU, Name, Price. Recommended: Description, Body HTML, Vendor, Product Type, Tags</p>
              {unmappedRequired.length > 0 && (
                <p className="text-red-600 font-semibold mt-1">⚠ Missing required: {unmappedRequired.join(", ")}</p>
              )}
            </div>
          </div>

          {/* Mapping Table */}
          <Card className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2.5 font-semibold w-[200px]">File Column</th>
                  <th className="text-center px-2 py-2.5 w-6"></th>
                  <th className="text-left px-4 py-2.5 font-semibold w-[200px]">System Field</th>
                  <th className="text-center px-4 py-2.5 font-semibold w-[80px]">Confidence</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Transform</th>
                  <th className="text-center px-3 py-2.5 font-semibold w-[60px]">Sample</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <React.Fragment key={m.fileCol}>
                    <tr className={`border-b ${confidenceBg(m.confidence)}`}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {(() => { const ct = columnTypes[m.fileCol]; const I = ct?.icon || Type; const c = ct?.type === "number" ? "text-blue-500" : ct?.type === "id" ? "text-purple-500" : "text-green-500"; return <I className={`h-3 w-3 ${c}`} />; })()}
                          <span className="font-medium">{m.fileCol}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <ArrowLeftRight className="h-3 w-3 text-muted-foreground mx-auto" />
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={m.systemField}
                          onChange={(e) => updateMapping(m.fileCol, "systemField", e.target.value)}
                          className="h-7 w-full rounded border bg-background text-xs px-2"
                        >
                          {systemFields.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[10px] font-bold ${confidenceColor(m.confidence)}`}>
                          {m.confidence >= 90 ? "✅" : m.confidence >= 70 ? "⚠️" : "❌"} {m.confidence}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={m.transform}
                          onChange={(e) => updateMapping(m.fileCol, "transform", e.target.value)}
                          className="h-7 w-full rounded border bg-background text-[10px] px-2"
                        >
                          <option value="none">No transform</option>
                          <option value="trim">Trim whitespace</option>
                          <option value="lowercase">Convert to lowercase</option>
                          <option value="uppercase">Convert to UPPERCASE</option>
                          <option value="titlecase">Title Case</option>
                          <option value="remove_currency">Remove currency ($, SAR)</option>
                          <option value="strip_html">Strip HTML tags</option>
                        </select>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => toggleSamples(m.fileCol)}
                          className="h-6 w-6 rounded hover:bg-muted flex items-center justify-center mx-auto"
                        >
                          {showSamples.has(m.fileCol) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      </td>
                    </tr>
                    {/* Sample Data Row */}
                    {showSamples.has(m.fileCol) && (
                      <tr key={`${m.fileCol}-sample`} className="border-b bg-muted/20">
                        <td colSpan={6} className="px-8 py-2">
                          <div className="text-[10px] text-muted-foreground">
                            <span className="font-semibold">Sample values: </span>
                            {m.sampleValues.map((v, i) => (
                              <span key={i}>
                                <code className="bg-muted px-1 py-0.5 rounded font-mono">{v}</code>
                                {i < m.sampleValues.length - 1 && <span className="mx-1">·</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(1)}>Back</Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(3)}>
              Continue to Import <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          STEP 4: IMPORT
         ═══════════════════════════════════════════════════ */}
      {currentStep === 3 && (
        <div className="space-y-4">
          {/* Pre-Import Summary */}
          {!importDone && !importing && (
            <>
              <Card className="p-5 space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4" /> Import Summary
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-[10px] text-muted-foreground">Products</div>
                    <div className="text-base font-bold">1,247</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-[10px] text-muted-foreground">Columns Mapped</div>
                    <div className="text-base font-bold">8 / 8</div>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <div className="text-[10px] text-muted-foreground">Platform</div>
                    <div className="text-base font-bold flex items-center gap-1"><Store className="h-3.5 w-3.5" /> Shopify</div>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/30">
                    <div className="text-[10px] text-amber-600">Warnings</div>
                    <div className="text-base font-bold text-amber-600">{qualityStats.emptyRequired}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-purple-50/50 dark:bg-purple-950/10 border border-purple-200/30">
                    <div className="text-[10px] text-purple-600">Duplicates</div>
                    <div className="text-base font-bold text-purple-600">{qualityStats.duplicates}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-red-50/50 dark:bg-red-950/10 border border-red-200/30">
                    <div className="text-[10px] text-red-600">Will Skip</div>
                    <div className="text-base font-bold text-red-600">{qualityStats.invalidData}</div>
                  </div>
                </div>
              </Card>

              {/* Duplicate Handling */}
              <Card className="p-5 space-y-4">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Duplicate Handling
                </h2>
                <p className="text-[10px] text-muted-foreground">
                  {qualityStats.duplicates} duplicate products detected. Choose how to handle them:
                </p>

                <div className="space-y-2">
                  {([
                    { value: "skip", label: "Skip duplicates", desc: "Don't import rows that already exist", icon: SkipForward },
                    { value: "update", label: "Update existing", desc: "Overwrite existing product data with new values", icon: RefreshCw },
                    { value: "import_new", label: "Import as new", desc: "Create new products even if SKU exists", icon: Copy },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setDuplicateMode(opt.value)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                        duplicateMode === opt.value
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border/50 hover:border-primary/30"
                      }`}
                    >
                      <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        duplicateMode === opt.value ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}>
                        {duplicateMode === opt.value && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>
                      <opt.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <div className="text-xs font-semibold">{opt.label}</div>
                        <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-medium text-muted-foreground">Match by:</span>
                  <select
                    value={matchBy}
                    onChange={(e) => setMatchBy(e.target.value)}
                    className="h-7 rounded border bg-background text-[10px] px-2"
                  >
                    <option value="sku">SKU</option>
                    <option value="name">Product Name</option>
                    <option value="barcode">Barcode / EAN</option>
                  </select>
                </div>
              </Card>

              <div className="flex justify-between">
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(2)}>Back</Button>
                <Button onClick={handleImport} className="gap-1.5 text-xs">
                  <Upload className="h-3.5 w-3.5" /> Import 1,247 Products
                </Button>
              </div>
            </>
          )}

          {/* Importing Progress */}
          {importing && (
            <Card className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-semibold">Importing products...</span>
                </div>
                <span className="text-sm font-bold text-primary">{importProgress}%</span>
              </div>
              <Progress value={importProgress} className="h-2.5" />

              <div className="grid grid-cols-3 gap-3">
                <div className="p-2.5 rounded-lg bg-muted/50 text-center">
                  <div className="text-sm font-bold">{Math.round(1247 * importProgress / 100)}</div>
                  <div className="text-[10px] text-muted-foreground">of 1,247 imported</div>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/50 text-center">
                  <div className="text-sm font-bold">{(elapsed / 1000).toFixed(1)}s</div>
                  <div className="text-[10px] text-muted-foreground">Elapsed</div>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/50 text-center">
                  <div className="text-sm font-bold">~{remainingSeconds}s</div>
                  <div className="text-[10px] text-muted-foreground">Remaining</div>
                </div>
              </div>

              {lastImported && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <span className="font-semibold">Last imported:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded">{lastImported}</code>
                </div>
              )}
            </Card>
          )}

          {/* Import Complete Report */}
          {importDone && (
            <Card className="p-6 space-y-5">
              <div className="text-center space-y-3">
                <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                  <Check className="h-7 w-7 text-green-600" />
                </div>
                <h2 className="text-base font-bold text-green-700 dark:text-green-400">Import Complete!</h2>
              </div>

              <Separator />

              {/* Detailed Report */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold">Import Report</h3>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-green-50/50 dark:bg-green-950/10">
                    <span className="text-xs flex items-center gap-2"><Check className="h-3 w-3 text-green-600" /> Imported successfully</span>
                    <span className="text-xs font-bold text-green-700">1,220</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/10">
                    <span className="text-xs flex items-center gap-2"><RefreshCw className="h-3 w-3 text-blue-600" /> Duplicates updated</span>
                    <span className="text-xs font-bold text-blue-700">15</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/10">
                    <span className="text-xs flex items-center gap-2"><AlertTriangle className="h-3 w-3 text-amber-600" /> Imported with warnings</span>
                    <span className="text-xs font-bold text-amber-700">12</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-red-50/50 dark:bg-red-950/10">
                    <span className="text-xs flex items-center gap-2"><AlertCircle className="h-3 w-3 text-red-600" /> Failed</span>
                    <span className="text-xs font-bold text-red-700">0</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-muted/50">
                    <span className="text-xs flex items-center gap-2"><Timer className="h-3 w-3 text-muted-foreground" /> Completed in</span>
                    <span className="text-xs font-bold">{(elapsed / 1000).toFixed(1)} seconds</span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <Button onClick={() => router.push("/demo/products")} className="flex-1 gap-1.5 text-xs">
                  <Package className="h-3.5 w-3.5" /> View Products
                </Button>
                <Button variant="outline" className="flex-1 gap-1.5 text-xs">
                  <FileDown className="h-3.5 w-3.5" /> Download Report
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5 text-xs"
                  onClick={() => {
                    setCurrentStep(0);
                    setFileName("");
                    setImporting(false);
                    setImportDone(false);
                    setImportProgress(0);
                    setLastImported("");
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Import Another
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
