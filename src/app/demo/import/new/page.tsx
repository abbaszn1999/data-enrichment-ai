"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Clock,
  Settings2,
  StickyNote,
  Columns3,
  BarChart3,
  X,
  Hash,
  Type,
  Zap,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

/* ── Mock data for column mapping suggestions ──────────── */

const mockDetectedColumns = [
  { name: "Part Number", type: "text", suggestedMap: "SKU", confidence: 96, sample: "00LP-DELL-5520" },
  { name: "Item Description", type: "text", suggestedMap: "Product Name", confidence: 92, sample: "Dell Lat 5520 15.6in i7 16GB" },
  { name: "Unit Cost", type: "number", suggestedMap: "Price", confidence: 98, sample: "1150.00" },
  { name: "QTY Available", type: "number", suggestedMap: "Stock", confidence: 95, sample: "60" },
  { name: "Brand Name", type: "text", suggestedMap: "Brand", confidence: 99, sample: "Dell" },
  { name: "Weight (kg)", type: "number", suggestedMap: "Weight", confidence: 88, sample: "1.8" },
];

const mockQuality = {
  totalRows: 8,
  totalColumns: 6,
  emptyRows: 0,
  emptyCells: 2,
  duplicateRows: 0,
  encoding: "UTF-8",
};

const recentSuppliers = [
  { name: "Samsung Electronics", lastUsed: "3d ago", imports: 5 },
  { name: "Dell Wholesale", lastUsed: "12d ago", imports: 3 },
  { name: "HP Distribution", lastUsed: "1mo ago", imports: 2 },
];

/* ── Main Page ─────────────────────────────────────────── */

export default function DemoNewImportPage() {
  const router = useRouter();
  const [sessionName, setSessionName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [fileName, setFileName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMapping, setShowMapping] = useState(false);

  // Import settings
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [trimWhitespace, setTrimWhitespace] = useState(true);
  const [autoEncoding, setAutoEncoding] = useState(true);

  const handleFileSelect = () => {
    setFileName("samsung_q3_shipment.xlsx");
    if (!sessionName) setSessionName("Samsung Q3 Shipment");
    if (!supplier) setSupplier("Samsung Electronics");
  };

  const handleSubmit = async () => {
    if (!sessionName || !fileName) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/demo/import/session/rules");
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Upload className="h-5 w-5" /> New Import
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Upload a supplier sheet to start matching and enrichment</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Form — 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5 space-y-5">
            {/* Session Name */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Session Name</Label>
              <Input
                placeholder="e.g. Samsung Q3 Shipment"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                className="h-10"
              />
            </div>

            {/* Supplier */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Supplier</Label>
              <select
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Select supplier or type new...</option>
                <option value="Samsung Electronics">Samsung Electronics</option>
                <option value="Dell Wholesale">Dell Wholesale</option>
                <option value="HP Distribution">HP Distribution</option>
                <option value="__new__">+ New Supplier</option>
              </select>
              {supplier === "__new__" && (
                <Input placeholder="Enter new supplier name" className="h-9 mt-2" />
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                <StickyNote className="h-3 w-3" /> Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this import..."
                rows={2}
                className="w-full px-3 py-2 text-sm rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Supplier File</Label>
              <div
                onClick={handleFileSelect}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(); }}
                className={`flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                  isDragging ? "border-primary bg-primary/5" : fileName ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
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
                    <span className="text-[10px] text-muted-foreground/60">.xlsx, .xls, .csv (max 50MB)</span>
                  </>
                )}
              </div>
            </div>

            {/* File Quality + Stats */}
            {fileName && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-lg bg-muted/30 border text-center">
                    <div className="text-sm font-bold">{mockQuality.totalRows}</div>
                    <div className="text-[9px] text-muted-foreground">Rows</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30 border text-center">
                    <div className="text-sm font-bold">{mockQuality.totalColumns}</div>
                    <div className="text-[9px] text-muted-foreground">Columns</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30 border text-center">
                    <div className="text-sm font-bold">{mockQuality.encoding}</div>
                    <div className="text-[9px] text-muted-foreground">Encoding</div>
                  </div>
                </div>

                {/* Quality Checks */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>No empty rows detected</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {mockQuality.emptyCells > 0 ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    )}
                    <span>{mockQuality.emptyCells > 0 ? `${mockQuality.emptyCells} empty cells found` : "No empty cells"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span>No duplicate rows</span>
                  </div>
                </div>

                {/* Duplicate Session Warning */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Similar file detected</div>
                    <div className="text-[10px] text-amber-600/80">A file with similar content was imported in &quot;Samsung Q2 Shipment&quot; (3d ago). This may be a duplicate.</div>
                  </div>
                </div>

                {/* Column Mapping Preview (collapsible) */}
                <div>
                  <button
                    onClick={() => setShowMapping(!showMapping)}
                    className="flex items-center gap-2 text-xs font-medium text-primary hover:underline"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {showMapping ? "Hide" : "Show"} AI Column Mapping Preview
                  </button>
                  {showMapping && (
                    <div className="mt-2 space-y-1.5">
                      {mockDetectedColumns.map((col) => (
                        <div key={col.name} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border text-[11px]">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            {col.type === "number" ? (
                              <Hash className="h-3 w-3 text-purple-500 shrink-0" />
                            ) : (
                              <Type className="h-3 w-3 text-blue-500 shrink-0" />
                            )}
                            <span className="font-medium truncate">{col.name}</span>
                          </div>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="font-medium text-primary truncate">{col.suggestedMap}</span>
                          </div>
                          <Badge
                            variant="secondary"
                            className={`text-[8px] px-1.5 py-0 shrink-0 ${
                              col.confidence >= 95
                                ? "bg-green-50 text-green-700 dark:bg-green-950/30"
                                : col.confidence >= 85
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30"
                                : "bg-red-50 text-red-700 dark:bg-red-950/30"
                            }`}
                          >
                            {col.confidence}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Preview Table */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Preview (first 3 rows)</Label>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="bg-muted/50">
                          <th className="text-left px-3 py-1.5 font-semibold">Part Number</th>
                          <th className="text-left px-3 py-1.5 font-semibold">Item Description</th>
                          <th className="text-left px-3 py-1.5 font-semibold">Unit Cost</th>
                          <th className="text-left px-3 py-1.5 font-semibold">QTY Available</th>
                          <th className="text-left px-3 py-1.5 font-semibold">Brand Name</th>
                          <th className="text-left px-3 py-1.5 font-semibold">Weight (kg)</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t">
                          <td className="px-3 py-1.5 font-mono">00LP-DELL-5520</td>
                          <td className="px-3 py-1.5">Dell Lat 5520 15.6in i7 16GB</td>
                          <td className="px-3 py-1.5">1150.00</td>
                          <td className="px-3 py-1.5">60</td>
                          <td className="px-3 py-1.5">Dell</td>
                          <td className="px-3 py-1.5">1.8</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-1.5 font-mono">00LP-HP-840G9</td>
                          <td className="px-3 py-1.5">HP EliteBook 840 G9 14in i5</td>
                          <td className="px-3 py-1.5">1280.00</td>
                          <td className="px-3 py-1.5">45</td>
                          <td className="px-3 py-1.5">HP</td>
                          <td className="px-3 py-1.5">1.4</td>
                        </tr>
                        <tr className="border-t">
                          <td className="px-3 py-1.5 font-mono">00PH-SAM-S24U</td>
                          <td className="px-3 py-1.5">Galaxy S24 Ultra 512GB Titanium</td>
                          <td className="px-3 py-1.5">1050.00</td>
                          <td className="px-3 py-1.5">100</td>
                          <td className="px-3 py-1.5">Samsung</td>
                          <td className="px-3 py-1.5">0.23</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Import Settings (collapsible) */}
            <div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Import Settings
              </button>
              {showSettings && (
                <div className="mt-2 space-y-2 p-3 rounded-lg bg-muted/20 border">
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={skipEmpty} onChange={() => setSkipEmpty(!skipEmpty)} className="rounded" />
                    Skip empty rows
                  </label>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={trimWhitespace} onChange={() => setTrimWhitespace(!trimWhitespace)} className="rounded" />
                    Trim whitespace from values
                  </label>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input type="checkbox" checked={autoEncoding} onChange={() => setAutoEncoding(!autoEncoding)} className="rounded" />
                    Auto-detect file encoding
                  </label>
                </div>
              )}
            </div>

            <Button onClick={handleSubmit} disabled={!sessionName || !fileName || loading} className="w-full h-10 gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? "Processing file..." : "Continue to Matching Rules"}
            </Button>
          </Card>
        </div>

        {/* Right Sidebar — 1 col */}
        <div className="space-y-4">
          {/* Recent Suppliers */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Recent Suppliers
            </h3>
            <div className="space-y-2">
              {recentSuppliers.map((s) => (
                <button
                  key={s.name}
                  onClick={() => {
                    setSupplier(s.name);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    supplier === s.name ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="text-[11px] font-medium">{s.name}</div>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" /> {s.lastUsed}
                    </span>
                    <span>{s.imports} imports</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          {/* Quick Tips */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" /> Quick Tips
            </h3>
            <div className="space-y-2 text-[10px] text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">1.</span>
                <span>Include a <strong>SKU</strong> or <strong>Part Number</strong> column for best matching results</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">2.</span>
                <span>Headers should be in the <strong>first row</strong> of your file</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">3.</span>
                <span>Supported formats: <strong>.xlsx, .xls, .csv</strong></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">4.</span>
                <span>Files up to <strong>50MB</strong> and <strong>100K rows</strong> are supported</span>
              </div>
            </div>
          </Card>

          {/* Import Stats */}
          <Card className="p-4">
            <h3 className="text-xs font-semibold mb-3 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Your Import Stats
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Total imports</span>
                <span className="font-bold">12</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Products matched</span>
                <span className="font-bold">1,840</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Avg. match rate</span>
                <span className="font-bold text-green-600">94.2%</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Last import</span>
                <span className="font-medium">3d ago</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
