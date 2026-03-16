"use client";

import { useState } from "react";
import {
  Download,
  Check,
  ArrowRight,
  FileSpreadsheet,
  Eye,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockExportPlatforms, mockMasterProducts } from "../mock-data";

const steps = ["Select Data", "Choose Platform", "Map Fields", "Preview & Export"];

export default function DemoExportPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [dataSource, setDataSource] = useState("all");

  const platform = mockExportPlatforms.find((p) => p.id === selectedPlatform);

  const handleExport = async () => {
    setExporting(true);
    await new Promise((r) => setTimeout(r, 2000));
    setExporting(false);
    setExported(true);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Download className="h-5 w-5" /> Export Products
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Export your products in the format your platform requires</p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <button
              onClick={() => i <= currentStep && setCurrentStep(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === currentStep
                  ? "bg-primary text-primary-foreground"
                  : i < currentStep
                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 cursor-pointer"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {i < currentStep ? <Check className="h-3 w-3" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
              <span>{step}</span>
            </button>
            {i < steps.length - 1 && <div className={`w-8 h-0.5 ${i < currentStep ? "bg-green-400" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Data */}
      {currentStep === 0 && (
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">What do you want to export?</h2>
          <div className="space-y-2">
            {[
              { value: "all", label: "All Master Products", desc: `${mockMasterProducts.length} products`, count: mockMasterProducts.length },
              { value: "active", label: "Active Products Only", desc: `${mockMasterProducts.filter((p) => p.status === "active").length} products`, count: mockMasterProducts.filter((p) => p.status === "active").length },
              { value: "enriched", label: "Enriched Products Only", desc: "Products with AI-generated content", count: 9 },
              { value: "import", label: "Latest Import Session", desc: "Samsung Q3 Shipment — 4 new products", count: 4 },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  dataSource === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="dataSource"
                  value={opt.value}
                  checked={dataSource === opt.value}
                  onChange={() => setDataSource(opt.value)}
                  className="rounded-full"
                />
                <div className="flex-1">
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground">{opt.desc}</div>
                </div>
                <Badge variant="secondary" className="text-[9px]">{opt.count} rows</Badge>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(1)}>
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2: Choose Platform */}
      {currentStep === 1 && (
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">Choose export platform</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {mockExportPlatforms.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlatform(p.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-sm ${
                  selectedPlatform === p.id
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-transparent bg-muted/30 hover:border-muted-foreground/20"
                }`}
              >
                <div className="text-2xl mb-2">{p.icon}</div>
                <div className="text-xs font-semibold">{p.name}</div>
                <Badge variant="outline" className="text-[8px] mt-1.5">{p.format}</Badge>
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(0)}>Back</Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(2)} disabled={!selectedPlatform}>
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3: Map Fields */}
      {currentStep === 2 && platform && (
        <Card className="p-6 space-y-4">
          <h2 className="text-sm font-semibold">Column Mapping — {platform.name}</h2>
          <p className="text-[10px] text-muted-foreground">Map your data fields to {platform.name} columns. Pre-filled from template.</p>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-2 font-semibold">{platform.name} Field</th>
                  <th className="text-center px-4 py-2 w-8"></th>
                  <th className="text-left px-4 py-2 font-semibold">Your Data Field</th>
                  <th className="text-left px-4 py-2 font-semibold">Preview</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { pf: "SKU / Handle", sf: "sku", preview: "LP-MSI-RAID17" },
                  { pf: "Title", sf: "enhancedTitle", preview: "MSI Raider GE78 HX 17\" Gaming..." },
                  { pf: "Description / Body", sf: "marketingDescription", preview: "Dominate every game with..." },
                  { pf: "Price", sf: "price", preview: "2,800.00" },
                  { pf: "Stock / Inventory", sf: "stock", preview: "10" },
                  { pf: "Brand / Vendor", sf: "brand", preview: "MSI" },
                  { pf: "Category / Type", sf: "category", preview: "Gaming Laptops" },
                  { pf: "Image URL", sf: "imageUrls", preview: "https://..." },
                  { pf: "Tags / Keywords", sf: "seoKeywords", preview: "gaming laptop, rtx 4090..." },
                ].map((row) => (
                  <tr key={row.pf} className="border-b hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">{row.pf}</td>
                    <td className="px-4 py-2 text-center"><ArrowRight className="h-3 w-3 text-muted-foreground mx-auto" /></td>
                    <td className="px-4 py-2">
                      <select className="h-7 w-full rounded border bg-background text-xs px-2">
                        <option value={row.sf}>{row.sf}</option>
                        <option value="">-- Skip --</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-[10px] text-muted-foreground truncate max-w-[200px]">{row.preview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(1)}>Back</Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCurrentStep(3)}>
              Preview Export <Eye className="h-3.5 w-3.5" />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4: Preview & Export */}
      {currentStep === 3 && platform && (
        <div className="space-y-4">
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Export Preview — {platform.name}</h2>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>{platform.format} format</span>
                <span>•</span>
                <span>{dataSource === "all" ? mockMasterProducts.length : dataSource === "import" ? 4 : 9} rows</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left px-3 py-1.5 font-semibold">SKU</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Title</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Price</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Stock</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Brand</th>
                    <th className="text-left px-3 py-1.5 font-semibold">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {mockMasterProducts.slice(0, 5).map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="px-3 py-1.5 font-mono">{p.sku}</td>
                      <td className="px-3 py-1.5 truncate max-w-[200px]">{p.name}</td>
                      <td className="px-3 py-1.5">${p.price}</td>
                      <td className="px-3 py-1.5">{p.stock}</td>
                      <td className="px-3 py-1.5">{p.brand}</td>
                      <td className="px-3 py-1.5">{p.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">Showing first 5 rows of {dataSource === "all" ? mockMasterProducts.length : 4}</p>
          </Card>

          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setCurrentStep(2)}>Back</Button>
            {exported ? (
              <Badge className="bg-green-500 text-white text-xs gap-1.5 py-2 px-4">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Export downloaded successfully!
              </Badge>
            ) : (
              <Button onClick={handleExport} disabled={exporting} className="gap-1.5 text-xs">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exporting ? "Generating..." : `Download ${platform.name} ${platform.format}`}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
