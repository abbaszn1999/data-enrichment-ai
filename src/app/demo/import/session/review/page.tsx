"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Loader2,
  RefreshCw,
  Plus,
  Sparkles,
  Search,
  X,
  Download,
  TrendingDown,
  TrendingUp,
  ArrowUpDown,
  DollarSign,
  Package,
  AlertTriangle,
  CheckCircle2,
  Ban,
  CheckSquare,
  Square,
  MinusSquare,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { mockMatchResults } from "../../../mock-data";

/* ── Helpers ───────────────────────────────────────────── */

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0;
}

function pctChange(oldVal: string, newVal: string): number {
  const o = parseNum(oldVal);
  const n = parseNum(newVal);
  if (o === 0) return 0;
  return ((n - o) / o) * 100;
}

/* ── Stepper ───────────────────────────────────────────── */

function ImportStepper({ currentStep }: { currentStep: number }) {
  const steps = [
    { num: 1, label: "Matching Rules" },
    { num: 2, label: "Review Results" },
    { num: 3, label: "Enrichment Tool" },
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

/* ── Main Page ─────────────────────────────────────────── */

export default function DemoReviewPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"all" | "price" | "stock">("all");

  // Row approval state: "approved" | "rejected" | "pending"
  const [rowStates, setRowStates] = useState<Record<string, "approved" | "rejected" | "pending">>(() => {
    const init: Record<string, "approved" | "rejected" | "pending"> = {};
    mockMatchResults.existing.forEach((m) => { init[m.matchedSku] = "approved"; });
    mockMatchResults.new.forEach((m) => { init[m.supplierSku] = "approved"; });
    return init;
  });


  const handleContinue = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    router.push("/demo/import/session/enrich");
  };

  // Calculate stats
  const totalPriceImpact = useMemo(() => {
    let total = 0;
    mockMatchResults.existing.forEach((m) => {
      if (m.diff.price) {
        total += parseNum(m.diff.price.new) - parseNum(m.diff.price.old);
      }
    });
    return total;
  }, []);

  const totalStockChange = useMemo(() => {
    let total = 0;
    mockMatchResults.existing.forEach((m) => {
      if (m.diff.stock) {
        total += parseNum(m.diff.stock.new) - parseNum(m.diff.stock.old);
      }
    });
    return total;
  }, []);

  const priceChanges = mockMatchResults.existing.filter((m) => m.diff.price).length;
  const stockChanges = mockMatchResults.existing.filter((m) => m.diff.stock).length;
  const approvedCount = Object.values(rowStates).filter((s) => s === "approved").length;
  const rejectedCount = Object.values(rowStates).filter((s) => s === "rejected").length;

  // Big changes (>20%)
  const bigChanges = mockMatchResults.existing.filter((m) => {
    if (m.diff.price) {
      const pct = Math.abs(pctChange(m.diff.price.old, m.diff.price.new));
      return pct > 10;
    }
    return false;
  });

  // Filtered existing
  const filteredExisting = useMemo(() => {
    let result = [...mockMatchResults.existing];
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      result = result.filter((m) => m.matchedSku.toLowerCase().includes(s) || m.supplierSku.toLowerCase().includes(s));
    }
    if (filterType === "price") result = result.filter((m) => m.diff.price);
    if (filterType === "stock") result = result.filter((m) => m.diff.stock);
    return result;
  }, [searchTerm, filterType]);

  const filteredNew = useMemo(() => {
    if (!searchTerm) return mockMatchResults.new;
    const s = searchTerm.toLowerCase();
    return mockMatchResults.new.filter((m) =>
      m.supplierSku.toLowerCase().includes(s) || m.data["Item Description"].toLowerCase().includes(s)
    );
  }, [searchTerm]);

  const toggleRow = (key: string) => {
    setRowStates((prev) => {
      const current = prev[key];
      const next = current === "approved" ? "rejected" : "approved";
      return { ...prev, [key]: next };
    });
  };

  const bulkAction = (action: "approve_all" | "reject_all" | "approve_price" | "approve_stock") => {
    setRowStates((prev) => {
      const next = { ...prev };
      if (action === "approve_all") {
        Object.keys(next).forEach((k) => { next[k] = "approved"; });
      } else if (action === "reject_all") {
        Object.keys(next).forEach((k) => { next[k] = "rejected"; });
      } else if (action === "approve_price") {
        mockMatchResults.existing.forEach((m) => {
          if (m.diff.price) next[m.matchedSku] = "approved";
        });
      } else if (action === "approve_stock") {
        mockMatchResults.existing.forEach((m) => {
          if (m.diff.stock) next[m.matchedSku] = "approved";
        });
      }
      return next;
    });
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Samsung Q3 Shipment</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Review matching results and approve changes</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs">
            <Download className="h-3.5 w-3.5" /> Export Report
          </Button>
        </div>
      </div>

      <ImportStepper currentStep={2} />

      {/* Summary Cards */}
      <div className="grid grid-cols-6 gap-3">
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-green-600">{mockMatchResults.existing.length}</div>
          <div className="text-[9px] text-muted-foreground">Matched</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-blue-600">{mockMatchResults.new.length}</div>
          <div className="text-[9px] text-muted-foreground">New Products</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-amber-600">{priceChanges}</div>
          <div className="text-[9px] text-muted-foreground">Price Changes</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-purple-600">{stockChanges}</div>
          <div className="text-[9px] text-muted-foreground">Stock Changes</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-green-600">{approvedCount}</div>
          <div className="text-[9px] text-muted-foreground">Approved</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-lg font-bold text-red-500">{rejectedCount}</div>
          <div className="text-[9px] text-muted-foreground">Rejected</div>
        </Card>
      </div>

      {/* Impact Summary + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card className="p-3 flex items-center gap-3">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${totalPriceImpact < 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-green-50 dark:bg-green-950/30"}`}>
            <DollarSign className={`h-4 w-4 ${totalPriceImpact < 0 ? "text-red-500" : "text-green-500"}`} />
          </div>
          <div>
            <div className="text-xs font-semibold">Total Price Impact</div>
            <div className={`text-sm font-bold ${totalPriceImpact < 0 ? "text-red-600" : "text-green-600"}`}>
              {totalPriceImpact < 0 ? "-" : "+"}${Math.abs(totalPriceImpact).toFixed(2)} across {priceChanges} products
            </div>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${totalStockChange > 0 ? "bg-green-50 dark:bg-green-950/30" : "bg-amber-50 dark:bg-amber-950/30"}`}>
            <Package className={`h-4 w-4 ${totalStockChange > 0 ? "text-green-500" : "text-amber-500"}`} />
          </div>
          <div>
            <div className="text-xs font-semibold">Total Stock Change</div>
            <div className={`text-sm font-bold ${totalStockChange > 0 ? "text-green-600" : "text-amber-600"}`}>
              {totalStockChange > 0 ? "+" : ""}{totalStockChange} units across {stockChanges} products
            </div>
          </div>
        </Card>
      </div>

      {/* Big Change Alert */}
      {bigChanges.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/40">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400">Large Price Changes Detected</div>
            <div className="text-[10px] text-amber-600/80 mt-0.5">
              {bigChanges.length} products have price changes greater than 10%. Review carefully before approving.
            </div>
          </div>
        </div>
      )}

      {/* Tabs + Search + Filter + Bulk Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("existing")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "existing" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            Existing ({mockMatchResults.existing.length})
          </button>
          <button
            onClick={() => setActiveTab("new")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "new" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            New ({mockMatchResults.new.length})
          </button>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 w-40 pl-8 pr-7 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Filter (existing tab only) */}
        {activeTab === "existing" && (
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="h-8 px-2.5 text-xs rounded-md border bg-background"
          >
            <option value="all">All Changes</option>
            <option value="price">Price Only</option>
            <option value="stock">Stock Only</option>
          </select>
        )}

        {/* Bulk Actions */}
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-8 text-[10px] gap-1" onClick={() => bulkAction("approve_all")}>
            <CheckSquare className="h-3 w-3 text-green-600" /> Approve All
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-[10px] gap-1" onClick={() => bulkAction("reject_all")}>
            <Ban className="h-3 w-3 text-red-500" /> Reject All
          </Button>
        </div>
      </div>

      {/* Existing Products Table */}
      {activeTab === "existing" && (
        <Card className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2.5 w-8"></th>
                <th className="text-left px-3 py-2.5 font-semibold">Matched SKU</th>
                <th className="text-left px-3 py-2.5 font-semibold">Field</th>
                <th className="text-right px-3 py-2.5 font-semibold">Current</th>
                <th className="text-center px-3 py-2.5 w-8"></th>
                <th className="text-left px-3 py-2.5 font-semibold">New Value</th>
                <th className="text-center px-3 py-2.5 font-semibold">Change</th>
                <th className="text-center px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredExisting.map((match) =>
                Object.entries(match.diff).map(([field, values], i) => {
                  const pct = pctChange(values.old, values.new);
                  const isDecrease = pct < 0;
                  const isBigChange = Math.abs(pct) > 10;
                  const state = rowStates[match.matchedSku] || "approved";

                  return (
                    <tr
                      key={`${match.rowIndex}-${field}`}
                      className={`border-b transition-colors ${
                        state === "rejected"
                          ? "bg-red-50/30 dark:bg-red-950/5 opacity-60"
                          : "hover:bg-muted/20"
                      }`}
                    >
                      {i === 0 && (
                        <td className="px-3 py-2.5 text-center" rowSpan={Object.keys(match.diff).length}>
                          <button onClick={() => toggleRow(match.matchedSku)}>
                            {state === "approved" ? (
                              <CheckSquare className="h-4 w-4 text-green-600" />
                            ) : (
                              <Square className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </td>
                      )}
                      {i === 0 && (
                        <td className="px-3 py-2.5 font-mono text-[10px] font-semibold" rowSpan={Object.keys(match.diff).length}>
                          <div>{match.matchedSku}</div>
                          <div className="font-normal text-muted-foreground mt-0.5">{match.supplierSku}</div>
                        </td>
                      )}
                      <td className="px-3 py-2.5 font-medium capitalize">{field}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground font-mono">${values.old}</td>
                      <td className="px-3 py-2.5 text-center">
                        <ArrowRight className="h-3 w-3 text-muted-foreground mx-auto" />
                      </td>
                      <td className="px-3 py-2.5 font-semibold font-mono">${values.new}</td>
                      <td className="px-3 py-2.5 text-center">
                        <div className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
                          isDecrease ? "text-red-500" : "text-green-600"
                        }`}>
                          {isDecrease ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                          {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                          {isBigChange && <AlertTriangle className="h-2.5 w-2.5 text-amber-500 ml-0.5" />}
                        </div>
                      </td>
                      {i === 0 && (
                        <td className="px-3 py-2.5 text-center" rowSpan={Object.keys(match.diff).length}>
                          <Badge
                            variant="secondary"
                            className={`text-[8px] ${
                              state === "approved"
                                ? "bg-green-50 text-green-700 dark:bg-green-950/30"
                                : "bg-red-50 text-red-600 dark:bg-red-950/30"
                            }`}
                          >
                            {state === "approved" ? (
                              <><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Approved</>
                            ) : (
                              <><Ban className="h-2.5 w-2.5 mr-0.5" /> Rejected</>
                            )}
                          </Badge>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      )}

      {/* New Products Table */}
      {activeTab === "new" && (
        <Card className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2.5 w-8"></th>
                <th className="text-left px-3 py-2.5 font-semibold">Supplier SKU</th>
                <th className="text-left px-3 py-2.5 font-semibold">Description</th>
                <th className="text-left px-3 py-2.5 font-semibold">Brand</th>
                <th className="text-right px-3 py-2.5 font-semibold">Price</th>
                <th className="text-right px-3 py-2.5 font-semibold">Stock</th>
                <th className="text-center px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredNew.map((item) => {
                const state = rowStates[item.supplierSku] || "approved";
                return (
                  <tr
                    key={item.rowIndex}
                    className={`border-b transition-colors ${
                      state === "rejected" ? "bg-red-50/30 dark:bg-red-950/5 opacity-60" : "hover:bg-muted/20"
                    }`}
                  >
                    <td className="px-3 py-3 text-center">
                      <button onClick={() => toggleRow(item.supplierSku)}>
                        {state === "approved" ? (
                          <CheckSquare className="h-4 w-4 text-green-600" />
                        ) : (
                          <Square className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-mono text-[10px] font-semibold">{item.supplierSku}</td>
                    <td className="px-3 py-3">{item.data["Item Description"]}</td>
                    <td className="px-3 py-3 text-muted-foreground">{item.data["Brand Name"]}</td>
                    <td className="px-3 py-3 text-right font-mono">${item.data["Unit Cost"]}</td>
                    <td className="px-3 py-3 text-right font-mono">{item.data["QTY Available"]}</td>
                    <td className="px-3 py-3 text-center">
                      <Badge
                        variant="secondary"
                        className={`text-[8px] ${
                          state === "approved"
                            ? "bg-green-50 text-green-700 dark:bg-green-950/30"
                            : "bg-red-50 text-red-600 dark:bg-red-950/30"
                        }`}
                      >
                        {state === "approved" ? (
                          <><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Approved</>
                        ) : (
                          <><Ban className="h-2.5 w-2.5 mr-0.5" /> Rejected</>
                        )}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" size="sm" className="text-xs" onClick={() => router.back()}>Back</Button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {approvedCount} approved, {rejectedCount} rejected
          </span>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleContinue} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? "Opening Enrichment Tool..." : "Continue to Enrichment Tool"}
          </Button>
        </div>
      </div>
    </div>
  );
}
