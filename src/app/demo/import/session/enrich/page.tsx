"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Sparkles,
  Loader2,
  Play,
  Pause,
  CheckCircle2,
  AlertCircle,
  Plus,
  Settings2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { mockMatchResults } from "../../../mock-data";

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

const enrichmentColumns = [
  { id: "enhancedTitle", label: "Enhanced Title", enabled: true },
  { id: "marketingDescription", label: "Marketing Description", enabled: true },
  { id: "keyFeatures", label: "Key Features", enabled: true },
  { id: "category", label: "Category", enabled: true },
  { id: "seoKeywords", label: "SEO Keywords", enabled: false },
  { id: "imageUrls", label: "Image URLs", enabled: true },
  { id: "sourceUrls", label: "Source URLs", enabled: true },
];

const mockEnrichedResults: Record<string, Record<string, string>> = {
  "LP-MSI-RAID17": {
    enhancedTitle: "MSI Raider GE78 HX 17\" Gaming Laptop - Intel i9-13980HX, RTX 4090, 32GB DDR5, 2TB SSD",
    marketingDescription: "Dominate every game with the MSI Raider GE78 HX, featuring the latest Intel Core i9-13980HX processor and NVIDIA GeForce RTX 4090 graphics. The 17-inch QHD+ 240Hz display delivers buttery-smooth visuals...",
    keyFeatures: "RTX 4090 16GB GDDR6X | i9-13980HX 24-Core | 17\" QHD+ 240Hz | 32GB DDR5-5600 | 2TB NVMe SSD",
    category: "Electronics > Laptops > Gaming Laptops",
  },
  "PH-ONE-12PRO": {
    enhancedTitle: "OnePlus 12 Pro 5G Smartphone - Snapdragon 8 Gen 3, 256GB, Hasselblad Camera System",
    marketingDescription: "Experience flagship performance with the OnePlus 12 Pro, powered by the Snapdragon 8 Gen 3 processor. The Hasselblad-tuned triple camera system captures stunning photos...",
    keyFeatures: "Snapdragon 8 Gen 3 | 6.82\" 2K LTPO 120Hz | 50MP Hasselblad Camera | 5400mAh + 100W Charging",
    category: "Electronics > Smartphones > Android Phones",
  },
  "TB-SAM-S9FE": {
    enhancedTitle: "Samsung Galaxy Tab S9 FE 10.9\" Tablet - Exynos 1380, 128GB, S Pen Included, IP68",
    marketingDescription: "The Samsung Galaxy Tab S9 FE brings premium tablet features at an accessible price. With the included S Pen, IP68 water resistance, and vibrant 10.9-inch display...",
    keyFeatures: "Exynos 1380 | 10.9\" TFT 90Hz | 128GB + microSD | S Pen Included | IP68 Water Resistant",
    category: "Electronics > Tablets",
  },
  "AC-JBL-FLIP6": {
    enhancedTitle: "JBL Flip 6 Portable Bluetooth Speaker - IP67 Waterproof, 12-Hour Battery, PartyBoost",
    marketingDescription: "Take your music anywhere with the JBL Flip 6. Featuring powerful JBL Original Pro Sound, IP67 waterproof and dustproof rating, and up to 12 hours of playtime...",
    keyFeatures: "JBL Original Pro Sound | IP67 Waterproof | 12-Hour Battery | PartyBoost | USB-C Charging",
    category: "Electronics > Accessories > Audio",
  },
};

export default function DemoEnrichPage() {
  const router = useRouter();
  const [isEnriching, setIsEnriching] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [enrichedRows, setEnrichedRows] = useState<Set<number>>(new Set());
  const [showConfig, setShowConfig] = useState(false);
  const [addedToMaster, setAddedToMaster] = useState(false);
  const total = mockMatchResults.new.length;

  useEffect(() => {
    if (!isEnriching || isPaused) return;
    if (completed >= total) {
      setIsEnriching(false);
      return;
    }
    const timer = setTimeout(() => {
      const newCompleted = completed + 1;
      setCompleted(newCompleted);
      setProgress(Math.round((newCompleted / total) * 100));
      setEnrichedRows((prev) => new Set([...prev, mockMatchResults.new[completed].rowIndex]));
    }, 2000);
    return () => clearTimeout(timer);
  }, [isEnriching, isPaused, completed, total]);

  const handleStartEnrich = () => {
    setIsEnriching(true);
    setIsPaused(false);
  };

  const handleAddToMaster = async () => {
    setAddedToMaster(true);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
          <p className="text-xs text-muted-foreground mt-0.5">AI Enrichment for {total} new products</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowConfig(!showConfig)}>
            <Settings2 className="h-3.5 w-3.5" /> Configure
          </Button>
          {!isEnriching && completed === 0 && (
            <Button size="sm" className="gap-1.5 text-xs" onClick={handleStartEnrich}>
              <Play className="h-3.5 w-3.5" /> Start Enrichment
            </Button>
          )}
          {isEnriching && (
            <Button size="sm" variant={isPaused ? "default" : "outline"} className="gap-1.5 text-xs" onClick={() => setIsPaused(!isPaused)}>
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {isPaused ? "Resume" : "Pause"}
            </Button>
          )}
        </div>
      </div>

      <ImportStepper currentStep={4} />

      {/* Config Panel */}
      {showConfig && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Enrichment Configuration</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase">Language</label>
              <select className="w-full h-8 px-2 text-xs rounded border bg-background mt-1">
                <option>English</option>
                <option>Arabic</option>
                <option>French</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase">Model</label>
              <select className="w-full h-8 px-2 text-xs rounded border bg-background mt-1">
                <option>Gemini Pro (Best Quality)</option>
                <option>Gemini Flash (Fastest)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase">Thinking Level</label>
              <select className="w-full h-8 px-2 text-xs rounded border bg-background mt-1">
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase">Writing Tone</label>
              <select className="w-full h-8 px-2 text-xs rounded border bg-background mt-1">
                <option>Professional</option>
                <option>Persuasive</option>
                <option>Simple</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase">Enrichment Columns</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {enrichmentColumns.map((col) => (
                <label key={col.id} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded-md px-2 py-1">
                  <input type="checkbox" defaultChecked={col.enabled} className="rounded" />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Progress Bar */}
      {(isEnriching || completed > 0) && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {isEnriching && !isPaused && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {isPaused && <Pause className="h-4 w-4 text-amber-500" />}
              {completed === total && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              <span className="text-xs font-medium">
                {completed === total
                  ? "Enrichment complete!"
                  : isPaused
                  ? "Paused"
                  : `Enriching product ${completed + 1} of ${total}...`}
              </span>
            </div>
            <span className="text-xs font-bold text-primary">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
            <span>{completed} completed</span>
            <span>{total - completed} remaining</span>
          </div>
        </Card>
      )}

      {/* Results Table */}
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-4 py-2.5 font-semibold w-8"><input type="checkbox" className="rounded" /></th>
              <th className="text-left px-4 py-2.5 font-semibold">SKU</th>
              <th className="text-left px-4 py-2.5 font-semibold">Original Description</th>
              <th className="text-left px-4 py-2.5 font-semibold">Enhanced Title</th>
              <th className="text-left px-4 py-2.5 font-semibold">Category</th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {mockMatchResults.new.map((item) => {
              const isEnrichedRow = enrichedRows.has(item.rowIndex);
              const enrichedData = mockEnrichedResults[item.supplierSku];
              const isCurrentlyProcessing = isEnriching && !isPaused && completed < total &&
                mockMatchResults.new[completed]?.rowIndex === item.rowIndex;
              return (
                <tr key={item.rowIndex} className={`border-b transition-colors ${
                  isEnrichedRow ? "bg-green-50/30 dark:bg-green-950/10" : isCurrentlyProcessing ? "bg-amber-50/30 dark:bg-amber-950/10" : ""
                }`}>
                  <td className="px-4 py-3"><input type="checkbox" className="rounded" defaultChecked /></td>
                  <td className="px-4 py-3 font-mono text-[10px]">{item.supplierSku}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item.data["Item Description"]}</td>
                  <td className="px-4 py-3">
                    {isCurrentlyProcessing && (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        <span className="text-muted-foreground italic">Generating...</span>
                      </div>
                    )}
                    {isEnrichedRow && enrichedData && (
                      <span className="font-medium text-green-700 dark:text-green-400">{enrichedData.enhancedTitle}</span>
                    )}
                    {!isEnrichedRow && !isCurrentlyProcessing && (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEnrichedRow && enrichedData ? (
                      <Badge variant="secondary" className="text-[9px]">{enrichedData.category?.split(" > ").pop()}</Badge>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isCurrentlyProcessing && (
                      <Badge variant="secondary" className="text-[9px] bg-amber-50 dark:bg-amber-950/30 text-amber-700 gap-1">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing
                      </Badge>
                    )}
                    {isEnrichedRow && (
                      <Badge variant="secondary" className="text-[9px] bg-green-50 dark:bg-green-950/30 text-green-700 gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Done
                      </Badge>
                    )}
                    {!isEnrichedRow && !isCurrentlyProcessing && (
                      <Badge variant="outline" className="text-[9px]">Pending</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Add to Master */}
      {completed === total && (
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>Back to Review</Button>
          {addedToMaster ? (
            <Badge className="bg-green-500 text-white text-xs gap-1 py-1.5 px-4">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {total} products added to master catalog!
            </Badge>
          ) : (
            <Button onClick={handleAddToMaster} className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add {total} Products to Master Catalog
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
