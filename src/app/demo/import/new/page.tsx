"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DemoNewImportPage() {
  const router = useRouter();
  const [sessionName, setSessionName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = () => {
    setFileName("samsung_q3_shipment.xlsx");
    if (!sessionName) setSessionName("Samsung Q3 Shipment");
    if (!supplier) setSupplier("Samsung Electronics");
  };

  const handleSubmit = async () => {
    if (!sessionName || !fileName) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    router.push("/demo/import/session/mapping");
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Upload className="h-5 w-5" /> New Import
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Upload a supplier sheet to start matching and enrichment</p>
      </div>

      <Card className="p-6 space-y-5">
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

        {/* File Upload */}
        <div className="space-y-2">
          <Label className="text-xs font-medium">Supplier File</Label>
          <div
            onClick={handleFileSelect}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(); }}
            className={`flex flex-col items-center justify-center gap-3 p-10 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
              isDragging ? "border-primary bg-primary/5" : fileName ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
            }`}
          >
            {fileName ? (
              <>
                <FileSpreadsheet className="h-10 w-10 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">{fileName}</span>
                <span className="text-[10px] text-muted-foreground">8 rows detected • 6 columns • Click to change</span>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Drag & drop or click to browse</span>
                <span className="text-[10px] text-muted-foreground/60">.xlsx, .xls, .csv</span>
              </>
            )}
          </div>
        </div>

        {/* Preview */}
        {fileName && (
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
        )}

        <Button onClick={handleSubmit} disabled={!sessionName || !fileName || loading} className="w-full h-10 gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {loading ? "Processing file..." : "Continue to Column Mapping"}
        </Button>
      </Card>
    </div>
  );
}
