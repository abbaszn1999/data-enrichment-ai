"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Calculator,
  Type,
  Link2,
  Trash,
  Copy,
  Hash,
  ArrowRight,
  Percent,
  Plus,
  Minus,
  X,
  Divide,
  CaseSensitive,
  CaseUpper,
  CaseLower,
  RemoveFormatting,
  Search,
  Replace,
  Scissors,
  Merge,
  Eraser,
  Filter,
  FileDigit,
  ChevronDown,
  ChevronRight,
  Undo2,
  Zap,
  SendHorizonal,
  Bot,
  Loader2,
  Check,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import type { AiFunctionPlan } from "@/app/api/ai-function/route";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSheetStore } from "@/store/sheet-store";

type FunctionCategory = "math" | "text" | "generate" | "clean" | "copy";
type MathOp = "add_percent" | "sub_percent" | "add_fixed" | "sub_fixed" | "multiply" | "divide" | "round";
type TextOp = "uppercase" | "lowercase" | "titlecase" | "trim" | "prefix" | "suffix" | "find_replace";
type GenerateOp = "slug" | "sku" | "extract_numbers" | "split";
type CleanOp = "remove_duplicates" | "remove_empty" | "strip_html" | "standardize";
type CopyOp = "copy_column" | "fill_empty" | "concatenate" | "conditional";

interface FunctionOperation {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  category: FunctionCategory;
}

const MATH_OPS: FunctionOperation[] = [
  { id: "add_percent", label: "Add %", description: "Increase by percentage (markup)", icon: <Percent className="h-3 w-3" />, category: "math" },
  { id: "sub_percent", label: "Sub %", description: "Decrease by percentage (discount)", icon: <Percent className="h-3 w-3" />, category: "math" },
  { id: "add_fixed", label: "Add $", description: "Add fixed amount", icon: <Plus className="h-3 w-3" />, category: "math" },
  { id: "sub_fixed", label: "Sub $", description: "Subtract fixed amount", icon: <Minus className="h-3 w-3" />, category: "math" },
  { id: "multiply", label: "Multiply", description: "Multiply (currency conversion)", icon: <X className="h-3 w-3" />, category: "math" },
  { id: "divide", label: "Divide", description: "Divide values", icon: <Divide className="h-3 w-3" />, category: "math" },
  { id: "round", label: "Round", description: "Round to decimal places", icon: <Hash className="h-3 w-3" />, category: "math" },
];

const TEXT_OPS: FunctionOperation[] = [
  { id: "uppercase", label: "UPPER", description: "Convert to uppercase", icon: <CaseUpper className="h-3 w-3" />, category: "text" },
  { id: "lowercase", label: "lower", description: "Convert to lowercase", icon: <CaseLower className="h-3 w-3" />, category: "text" },
  { id: "titlecase", label: "Title", description: "Title Case Each Word", icon: <CaseSensitive className="h-3 w-3" />, category: "text" },
  { id: "trim", label: "Trim", description: "Remove extra spaces", icon: <RemoveFormatting className="h-3 w-3" />, category: "text" },
  { id: "prefix", label: "Prefix", description: "Add text before each value", icon: <Plus className="h-3 w-3" />, category: "text" },
  { id: "suffix", label: "Suffix", description: "Add text after each value", icon: <Plus className="h-3 w-3" />, category: "text" },
  { id: "find_replace", label: "Find & Replace", description: "Search and replace text", icon: <Replace className="h-3 w-3" />, category: "text" },
];

const GENERATE_OPS: FunctionOperation[] = [
  { id: "slug", label: "URL Slug", description: "Generate URL-friendly slug from text", icon: <Link2 className="h-3 w-3" />, category: "generate" },
  { id: "sku", label: "SKU", description: "Generate SKU from Brand + Category", icon: <Hash className="h-3 w-3" />, category: "generate" },
  { id: "extract_numbers", label: "Extract Numbers", description: "Pull numbers from text (weight, size)", icon: <FileDigit className="h-3 w-3" />, category: "generate" },
  { id: "split", label: "Split", description: "Split column by delimiter (comma, pipe)", icon: <Scissors className="h-3 w-3" />, category: "generate" },
];

const CLEAN_OPS: FunctionOperation[] = [
  { id: "remove_duplicates", label: "Remove Duplicates", description: "Find and remove duplicate rows by column", icon: <Filter className="h-3 w-3" />, category: "clean" },
  { id: "remove_empty", label: "Remove Empty", description: "Delete rows where column is empty", icon: <Eraser className="h-3 w-3" />, category: "clean" },
  { id: "strip_html", label: "Strip HTML", description: "Remove HTML tags from text", icon: <RemoveFormatting className="h-3 w-3" />, category: "clean" },
  { id: "standardize", label: "Standardize", description: "Unify values (kg/KG/Kg → kg)", icon: <Type className="h-3 w-3" />, category: "clean" },
];

const COPY_OPS: FunctionOperation[] = [
  { id: "copy_column", label: "Copy Column", description: "Copy values from another column", icon: <Copy className="h-3 w-3" />, category: "copy" },
  { id: "fill_empty", label: "Fill Empty", description: "Fill blank cells with a default value", icon: <Plus className="h-3 w-3" />, category: "copy" },
  { id: "concatenate", label: "Concatenate", description: "Merge two columns into one", icon: <Merge className="h-3 w-3" />, category: "copy" },
  { id: "conditional", label: "If Empty", description: "If column A empty, use column B", icon: <ArrowRight className="h-3 w-3" />, category: "copy" },
];

const CATEGORIES: { id: FunctionCategory; label: string; icon: React.ReactNode; ops: FunctionOperation[] }[] = [
  { id: "math", label: "Math", icon: <Calculator className="h-3.5 w-3.5" />, ops: MATH_OPS },
  { id: "text", label: "Text", icon: <Type className="h-3.5 w-3.5" />, ops: TEXT_OPS },
  { id: "generate", label: "Generate", icon: <Link2 className="h-3.5 w-3.5" />, ops: GENERATE_OPS },
  { id: "clean", label: "Clean", icon: <Trash className="h-3.5 w-3.5" />, ops: CLEAN_OPS },
  { id: "copy", label: "Copy & Fill", icon: <Copy className="h-3.5 w-3.5" />, ops: COPY_OPS },
];

function applyPreview(value: string, op: string, param: string, param2?: string): string {
  const num = parseFloat(value.replace(/[^0-9.\-]/g, ""));
  const p = parseFloat(param);

  switch (op) {
    case "add_percent": return isNaN(num) || isNaN(p) ? value : (num * (1 + p / 100)).toFixed(2);
    case "sub_percent": return isNaN(num) || isNaN(p) ? value : (num * (1 - p / 100)).toFixed(2);
    case "add_fixed": return isNaN(num) || isNaN(p) ? value : (num + p).toFixed(2);
    case "sub_fixed": return isNaN(num) || isNaN(p) ? value : (num - p).toFixed(2);
    case "multiply": return isNaN(num) || isNaN(p) ? value : (num * p).toFixed(2);
    case "divide": return isNaN(num) || isNaN(p) || p === 0 ? value : (num / p).toFixed(2);
    case "round": return isNaN(num) ? value : num.toFixed(isNaN(p) ? 0 : p);
    case "uppercase": return value.toUpperCase();
    case "lowercase": return value.toLowerCase();
    case "titlecase": return value.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
    case "trim": return value.replace(/\s+/g, " ").trim();
    case "prefix": return param + value;
    case "suffix": return value + param;
    case "find_replace": return param ? value.replaceAll(param, param2 || "") : value;
    case "slug": return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    case "extract_numbers": { const m = value.match(/[\d.]+/g); return m ? m.join(", ") : ""; }
    case "strip_html": return value.replace(/<[^>]*>/g, "").trim();
    case "fill_empty": return value.trim() === "" ? param : value;
    default: return value;
  }
}

export function FunctionsPanel() {
  const { rows, originalColumns, selectedRowIds, enrichmentColumns } = useSheetStore();

  const [selectedColumn, setSelectedColumn] = useState<string>("");
  const [applyTo, setApplyTo] = useState<"selected" | "all">("selected");
  const [expandedCategory, setExpandedCategory] = useState<FunctionCategory | null>("math");
  const [activeOp, setActiveOp] = useState<string | null>(null);
  const [param1, setParam1] = useState("");
  const [param2, setParam2] = useState("");
  const [lastOperation, setLastOperation] = useState<string | null>(null);
  const [highlightColumn, setHighlightColumn] = useState(false);
  const selectRef = useCallback((node: HTMLSelectElement | null) => {
    if (node && highlightColumn) {
      node.focus();
    }
  }, [highlightColumn]);

  // All available columns (original + enriched that have data)
  const allColumns = useMemo(() => {
    const enrichedCols = enrichmentColumns
      .filter((c) => rows.some((r) => {
        const v = r.enrichedData?.[c.id];
        return v !== undefined && v !== null && v !== "";
      }))
      .map((c) => c.id);
    return [...originalColumns, ...enrichedCols];
  }, [originalColumns, enrichmentColumns, rows]);

  // Get column display name
  const getColName = useCallback((col: string) => {
    const enrichCol = enrichmentColumns.find((c) => c.id === col);
    if (enrichCol) return enrichCol.label;
    return col.replace("__EMPTY_", "Col ").replace("__EMPTY", "Col");
  }, [enrichmentColumns]);

  // Detect if selected column is numeric
  const isNumericColumn = useMemo(() => {
    if (!selectedColumn) return false;
    const sampleValues = rows.slice(0, 10).map((r) => {
      const enrichCol = enrichmentColumns.find((c) => c.id === selectedColumn);
      if (enrichCol) return String(r.enrichedData?.[selectedColumn] || "");
      return r.originalData[selectedColumn] || "";
    }).filter(Boolean);
    return sampleValues.length > 0 && sampleValues.every((v) => !isNaN(parseFloat(v.replace(/[^0-9.\-]/g, ""))));
  }, [selectedColumn, rows, enrichmentColumns]);

  // Get sample values for preview
  const sampleValues = useMemo(() => {
    if (!selectedColumn) return [];
    const targetRows = applyTo === "selected"
      ? rows.filter((r) => selectedRowIds.has(r.id))
      : rows;
    return targetRows.slice(0, 3).map((r) => {
      const enrichCol = enrichmentColumns.find((c) => c.id === selectedColumn);
      if (enrichCol) return String(r.enrichedData?.[selectedColumn] || "");
      return r.originalData[selectedColumn] || "";
    });
  }, [selectedColumn, rows, selectedRowIds, applyTo, enrichmentColumns]);

  const targetRowCount = applyTo === "selected" ? selectedRowIds.size : rows.length;

  const handleApply = useCallback(() => {
    if (!selectedColumn || !activeOp) return;

    const store = useSheetStore.getState();
    const targetRows = applyTo === "selected"
      ? store.rows.filter((r) => selectedRowIds.has(r.id))
      : store.rows;

    let applied = 0;
    const isEnrichedCol = enrichmentColumns.some((c) => c.id === selectedColumn);

    for (const row of targetRows) {
      const currentVal = isEnrichedCol
        ? String(row.enrichedData?.[selectedColumn] || "")
        : row.originalData[selectedColumn] || "";

      const newVal = applyPreview(currentVal, activeOp, param1, param2);
      if (newVal !== currentVal) {
        if (isEnrichedCol) {
          store.updateEnrichedCellValue(row.id, selectedColumn, newVal);
        } else {
          store.updateCellValue(row.id, selectedColumn, newVal);
        }
        applied++;
      }
    }

    const opLabel = [...MATH_OPS, ...TEXT_OPS, ...GENERATE_OPS, ...CLEAN_OPS, ...COPY_OPS].find((o) => o.id === activeOp)?.label || activeOp;
    setLastOperation(`${opLabel} on "${getColName(selectedColumn)}" — ${applied} cells updated`);
    toast.success(`${opLabel} applied`, { description: `${applied} cells updated in "${getColName(selectedColumn)}"` });
  }, [selectedColumn, activeOp, applyTo, param1, param2, selectedRowIds, enrichmentColumns, getColName]);

  const toggleCategory = (cat: FunctionCategory) => {
    setExpandedCategory(expandedCategory === cat ? null : cat);
    setActiveOp(null);
    setParam1("");
    setParam2("");
  };

  // Smart: auto-expand math if numeric column, text otherwise
  const handleColumnChange = (col: string) => {
    setSelectedColumn(col);
    setActiveOp(null);
    setParam1("");
    setParam2("");
  };

  const needsParam1 = activeOp && !["uppercase", "lowercase", "titlecase", "trim", "strip_html", "slug", "extract_numbers", "remove_duplicates", "remove_empty"].includes(activeOp);
  const needsParam2 = activeOp === "find_replace" || activeOp === "concatenate" || activeOp === "conditional";

  const getParam1Label = () => {
    switch (activeOp) {
      case "add_percent": case "sub_percent": return "Percentage";
      case "add_fixed": case "sub_fixed": return "Amount";
      case "multiply": return "Multiply by";
      case "divide": return "Divide by";
      case "round": return "Decimal places";
      case "prefix": return "Text to add before";
      case "suffix": return "Text to add after";
      case "find_replace": return "Find";
      case "fill_empty": return "Default value";
      case "split": return "Delimiter (e.g. , or |)";
      case "copy_column": return "Source column";
      case "concatenate": return "Column A";
      case "conditional": return "Fallback column";
      case "standardize": return "Target format (e.g. kg)";
      case "sku": return "Pattern (e.g. {Brand}-{Category}-{#})";
      default: return "Value";
    }
  };

  const getParam2Label = () => {
    switch (activeOp) {
      case "find_replace": return "Replace with";
      case "concatenate": return "Separator (e.g. space, -)";
      case "conditional": return "Default if both empty";
      default: return "Value";
    }
  };

  return (
    <>
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-4">
        {/* Column Selector */}
        <div className="space-y-2">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Apply to Column
          </label>
          <select
            ref={selectRef}
            value={selectedColumn}
            onChange={(e) => { handleColumnChange(e.target.value); setHighlightColumn(false); }}
            className={`w-full h-8 px-2.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all ${
              highlightColumn
                ? "border-red-500 ring-2 ring-red-500/30 animate-pulse"
                : selectedColumn
                ? "border-primary/50"
                : ""
            }`}
          >
            <option value="">Select a column...</option>
            <optgroup label="Original Columns">
              {originalColumns.map((col) => (
                <option key={col} value={col}>{getColName(col)}</option>
              ))}
            </optgroup>
            {allColumns.filter((c) => !originalColumns.includes(c)).length > 0 && (
              <optgroup label="Enriched Columns">
                {allColumns.filter((c) => !originalColumns.includes(c)).map((col) => (
                  <option key={col} value={col}>{getColName(col)}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Apply To */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-medium">Rows:</span>
          <div className="flex items-center bg-muted rounded-lg p-0.5 flex-1">
            <button
              onClick={() => setApplyTo("selected")}
              className={`flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                applyTo === "selected"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Selected ({selectedRowIds.size})
            </button>
            <button
              onClick={() => setApplyTo("all")}
              className={`flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                applyTo === "all"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              All ({rows.length})
            </button>
          </div>
        </div>

        <Separator />

        {/* Function Categories */}
        {CATEGORIES.map((cat) => {
          const isExpanded = expandedCategory === cat.id;
          // Auto-suggest: show math first for numeric, text first for text columns
          const isRelevant = selectedColumn && (
            (cat.id === "math" && isNumericColumn) ||
            (cat.id === "text" && !isNumericColumn)
          );

          return (
            <div key={cat.id}>
              <button
                onClick={() => toggleCategory(cat.id)}
                className={`w-full flex items-center gap-2 py-1.5 text-xs font-semibold transition-colors ${
                  isExpanded ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {isExpanded
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />
                }
                {cat.icon}
                <span>{cat.label}</span>
                {isRelevant && (
                  <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto bg-primary/10 text-primary">
                    Suggested
                  </Badge>
                )}
              </button>

              {isExpanded && (
                <div className="pl-5 mt-1 space-y-1">
                  {/* Quick action buttons */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {cat.ops.map((op) => (
                      <button
                        key={op.id}
                        onClick={() => {
                          if (!selectedColumn) {
                            setHighlightColumn(true);
                            setTimeout(() => setHighlightColumn(false), 2000);
                            toast.warning("Select a column first", { description: "Choose a column from the dropdown above" });
                            return;
                          }
                          setActiveOp(activeOp === op.id ? null : op.id);
                          setParam1("");
                          setParam2("");
                        }}
                        title={op.description}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all ${
                          activeOp === op.id
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : !selectedColumn
                            ? "bg-muted/50 border-border/50 text-muted-foreground/50 hover:text-muted-foreground"
                            : "bg-muted/50 border-border/50 text-muted-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
                        }`}
                      >
                        {op.icon}
                        {op.label}
                      </button>
                    ))}
                  </div>

                  {/* Active operation params */}
                  {activeOp && cat.ops.some((o) => o.id === activeOp) && (
                    <div className="space-y-2 p-2.5 rounded-lg border bg-muted/20">
                      <div className="text-[10px] font-semibold text-foreground">
                        {cat.ops.find((o) => o.id === activeOp)?.description}
                      </div>

                      {needsParam1 && (
                        <div className="space-y-1">
                          <label className="text-[9px] font-medium text-muted-foreground">{getParam1Label()}</label>
                          {activeOp === "copy_column" || activeOp === "conditional" ? (
                            <select
                              value={param1}
                              onChange={(e) => setParam1(e.target.value)}
                              className="w-full h-7 px-2 text-[10px] rounded border bg-background"
                            >
                              <option value="">Select column...</option>
                              {allColumns.filter((c) => c !== selectedColumn).map((col) => (
                                <option key={col} value={col}>{getColName(col)}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={["add_percent", "sub_percent", "add_fixed", "sub_fixed", "multiply", "divide", "round"].includes(activeOp) ? "number" : "text"}
                              value={param1}
                              onChange={(e) => setParam1(e.target.value)}
                              placeholder={
                                activeOp === "add_percent" ? "e.g. 10" :
                                activeOp === "multiply" ? "e.g. 3.75" :
                                activeOp === "prefix" ? "e.g. Brand - " :
                                activeOp === "find_replace" ? "Text to find..." :
                                "Enter value..."
                              }
                              className="w-full h-7 px-2 text-[10px] rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                            />
                          )}
                        </div>
                      )}

                      {needsParam2 && (
                        <div className="space-y-1">
                          <label className="text-[9px] font-medium text-muted-foreground">{getParam2Label()}</label>
                          <input
                            type="text"
                            value={param2}
                            onChange={(e) => setParam2(e.target.value)}
                            placeholder={activeOp === "find_replace" ? "Replace with..." : "Enter value..."}
                            className="w-full h-7 px-2 text-[10px] rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary/50"
                          />
                        </div>
                      )}

                      {/* Live Preview */}
                      {selectedColumn && sampleValues.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Preview</div>
                          <div className="rounded border bg-background overflow-hidden">
                            <table className="w-full text-[10px]">
                              <thead>
                                <tr className="bg-muted/50 border-b">
                                  <th className="text-left px-2 py-1 font-medium text-muted-foreground">Before</th>
                                  <th className="w-4"></th>
                                  <th className="text-left px-2 py-1 font-medium text-primary">After</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sampleValues.map((val, i) => {
                                  const after = applyPreview(val, activeOp, param1, param2);
                                  const changed = val !== after;
                                  return (
                                    <tr key={i} className={`border-b last:border-0 ${changed ? "bg-green-50/50 dark:bg-green-950/10" : ""}`}>
                                      <td className="px-2 py-1 font-mono text-muted-foreground truncate max-w-[100px]">{val || "—"}</td>
                                      <td className="text-center"><ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50 mx-auto" /></td>
                                      <td className={`px-2 py-1 font-mono truncate max-w-[100px] ${changed ? "text-green-700 dark:text-green-400 font-semibold" : "text-muted-foreground"}`}>
                                        {after || "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <Separator />

        {/* Last Operation */}
        {lastOperation && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-green-50/50 dark:bg-green-950/10 border border-green-200/50 dark:border-green-800/30">
            <Undo2 className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />
            <div className="text-[10px] text-green-700 dark:text-green-400">{lastOperation}</div>
          </div>
        )}

        {/* AI Function Section */}
        <AiFunctionChat
          onOperationDone={(msg) => setLastOperation(msg)}
        />
      </div>
    </div>

    {/* Fixed Footer — Apply Button */}
    <div className="p-4 border-t bg-muted/20 space-y-2">
      <Button
        onClick={handleApply}
        disabled={!selectedColumn || !activeOp}
        className="w-full gap-2 font-medium h-10 shadow-sm"
        size="sm"
      >
        <Zap className="h-4 w-4" />
        {selectedColumn && activeOp
          ? `Apply to ${targetRowCount} Row${targetRowCount !== 1 ? "s" : ""}`
          : "Select column & function"
        }
      </Button>
      {!selectedColumn && (
        <div className="text-[10px] text-center text-muted-foreground">
          Choose a column and function above
        </div>
      )}
    </div>
    </>
  );
}

// ═══════════════════════════════════════════════════
// AI Function Chat Component
// ═══════════════════════════════════════════════════

function buildRowObj(
  row: { originalData: Record<string, string>; enrichedData?: Record<string, unknown> },
  allColumns: string[],
  enrichmentColumns: { id: string }[],
): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const col of allColumns) {
    const isEnriched = enrichmentColumns.some((c) => c.id === col);
    obj[col] = isEnriched ? String(row.enrichedData?.[col] || "") : (row.originalData[col] || "");
  }
  return obj;
}

function runFnOnRow(fn: (row: Record<string, string>) => Record<string, string>, rowObj: Record<string, string>): Record<string, string> {
  try {
    const result = fn(rowObj);
    if (!result || typeof result !== "object") return {};
    return result;
  } catch {
    return {};
  }
}

function AiFunctionChat({ onOperationDone }: { onOperationDone: (msg: string) => void }) {
  const { rows, originalColumns, enrichmentColumns, selectedRowIds } = useSheetStore();
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<AiFunctionPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // All available columns
  const allColumns = useMemo(() => {
    const enrichedCols = enrichmentColumns
      .filter((c) => rows.some((r) => {
        const v = r.enrichedData?.[c.id];
        return v !== undefined && v !== null && v !== "";
      }))
      .map((c) => c.id);
    return [...originalColumns, ...enrichedCols];
  }, [originalColumns, enrichmentColumns, rows]);

  // Get display name for column
  const getColName = useCallback((col: string) => {
    const enrichCol = enrichmentColumns.find((c) => c.id === col);
    return enrichCol ? enrichCol.label : col;
  }, [enrichmentColumns]);

  // Build sample rows for AI context (only 5 rows, no IDs)
  const sampleRows = useMemo(() => {
    return rows.slice(0, 5).map((r) => buildRowObj(r, allColumns, enrichmentColumns));
  }, [rows, allColumns, enrichmentColumns]);

  // Build the JS function from plan
  const builtFn = useMemo(() => {
    if (!plan?.functionBody) return null;
    try {
      return new Function("row", plan.functionBody) as (row: Record<string, string>) => Record<string, string>;
    } catch {
      return null;
    }
  }, [plan]);

  // Only the selected rows
  const selectedRows = useMemo(() => {
    return rows.filter((r) => selectedRowIds.has(r.id));
  }, [rows, selectedRowIds]);

  // Run preview: execute function on first 4 selected rows to show before/after
  const preview = useMemo(() => {
    if (!plan || !builtFn) return null;
    const targetCol = plan.newColumn || plan.targetColumn;
    const previewRows = selectedRows.slice(0, 4);
    const items = previewRows.map((r) => {
      const rowObj = buildRowObj(r, allColumns, enrichmentColumns);
      const changes = runFnOnRow(builtFn, rowObj);
      const hasChanges = Object.keys(changes).length > 0;
      const before = plan.newColumn ? "" : (rowObj[targetCol] || "");
      const after = hasChanges ? (changes[targetCol] || "") : before;
      return {
        rowIndex: r.rowIndex,
        before,
        after,
        changed: before !== after || (plan.newColumn != null && hasChanges),
      };
    });

    // Count how many selected rows will actually be affected
    let totalAffected = 0;
    for (const r of selectedRows) {
      const rowObj = buildRowObj(r, allColumns, enrichmentColumns);
      const changes = runFnOnRow(builtFn, rowObj);
      if (Object.keys(changes).length > 0) totalAffected++;
    }

    return { items, totalAffected, targetCol };
  }, [plan, builtFn, selectedRows, allColumns, enrichmentColumns]);

  const handleSend = async (overrideCommand?: string) => {
    const cmd = overrideCommand ?? command.trim();
    if (!cmd || loading) return;
    setError(null);
    setPlan(null);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai-function", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          columns: allColumns,
          sampleRows,
          totalRows: rows.length,
          selectedRows: selectedRowIds.size,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "API error");
      }

      const data = await res.json();

      // Validate the function can be built
      try {
        new Function("row", data.plan.functionBody);
      } catch (syntaxErr: any) {
        throw new Error(`AI generated invalid function: ${syntaxErr.message}`);
      }

      setPlan(data.plan);
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError(null);
      } else {
        setError(err.message || "Failed to process command");
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRetry = () => {
    handleSend(command.trim());
  };

  const handleExecute = () => {
    if (!plan || !builtFn || executing) return;
    setExecuting(true);

    try {
      const store = useSheetStore.getState();
      let totalApplied = 0;

      // Add new column if needed
      if (plan.newColumn && !store.originalColumns.includes(plan.newColumn)) {
        const colName = plan.newColumn;
        useSheetStore.setState((s) => ({
          originalColumns: [...s.originalColumns, colName],
          rows: s.rows.map((r) => ({
            ...r,
            originalData: { ...r.originalData, [colName]: "" },
          })),
        }));
      }

      // Apply ONLY to selected rows
      const currentRows = useSheetStore.getState().rows.filter((r) => selectedRowIds.has(r.id));

      for (const row of currentRows) {
        const rowObj = buildRowObj(row, allColumns, enrichmentColumns);
        const changes = runFnOnRow(builtFn, rowObj);
        if (Object.keys(changes).length === 0) continue;

        for (const [col, newVal] of Object.entries(changes)) {
          const strVal = String(newVal);
          const isEnrichedCol = enrichmentColumns.some((c) => c.id === col);
          if (isEnrichedCol) {
            store.updateEnrichedCellValue(row.id, col, strVal);
          } else {
            store.updateCellValue(row.id, col, strVal);
          }
          totalApplied++;
        }
      }

      onOperationDone(`AI: ${plan.summary} — ${totalApplied} cells updated`);
      toast.success("AI Function executed", { description: `${totalApplied} cells updated` });
      setPlan(null);
      setCommand("");
    } catch (err: any) {
      toast.error("Execution failed", { description: err.message });
    } finally {
      setExecuting(false);
    }
  };

  const handleCancel = () => {
    setPlan(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasSelection = selectedRowIds.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">AI Function</span>
        <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-primary/10 text-primary">
          Beta
        </Badge>
      </div>

      {/* Locked state — no rows selected */}
      {!hasSelection ? (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed bg-muted/10 text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-40" />
          <div className="text-[10px] leading-relaxed">
            Select rows to enable AI Function.
          </div>
        </div>
      ) : (
        <>
      {/* Chat Input */}
      <div className="relative">
        <textarea
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Describe what to do with ${selectedRowIds.size} selected row${selectedRowIds.size !== 1 ? "s" : ""}...`}
          rows={2}
          disabled={loading || !!plan}
          className="w-full px-3 py-2 pr-10 text-[11px] rounded-lg border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        {loading ? (
          <button
            onClick={handleStop}
            className="absolute right-2 bottom-2 p-1 rounded-md text-destructive hover:bg-destructive/10 transition-colors"
            title="Stop"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={() => handleSend()}
            disabled={!command.trim() || !!plan}
            className="absolute right-2 bottom-2 p-1 rounded-md text-primary hover:bg-primary/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Send"
          >
            <SendHorizonal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1 text-[10px] text-destructive">{error}</div>
          <button
            onClick={handleRetry}
            className="shrink-0 flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80 font-medium underline underline-offset-2"
            title="Retry"
          >
            Retry
          </button>
        </div>
      )}

      {/* Plan Result */}
      {plan && (
        <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
          {/* Summary */}
          <div className="flex items-start gap-2">
            <Bot className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <div className="text-[11px] font-medium text-foreground leading-relaxed">
              {plan.summary}
            </div>
          </div>

          {/* Info */}
          <div className="text-[10px] text-muted-foreground pl-5">
            Target: <span className="font-medium text-foreground">{getColName(plan.newColumn || plan.targetColumn)}</span>
            {plan.newColumn && <span className="text-primary"> (new column)</span>}
            {preview && <span> · {preview.totalAffected} of {selectedRowIds.size} selected row{selectedRowIds.size !== 1 ? "s" : ""} will change</span>}
          </div>

          {/* Warnings */}
          {plan.warnings && plan.warnings.length > 0 && (
            <div className="flex items-start gap-1.5 pl-5">
              <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-[9px] text-amber-600 dark:text-amber-400">
                {plan.warnings.join(". ")}
              </div>
            </div>
          )}

          {/* Preview Table */}
          {preview && preview.items.length > 0 && (
            <div className="mt-2 space-y-1 pl-5">
              <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Preview — {getColName(preview.targetCol)}
              </div>
              <div className="rounded border bg-background overflow-hidden">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-2 py-1 font-medium text-muted-foreground w-6">#</th>
                      <th className="text-left px-2 py-1 font-medium text-muted-foreground">Before</th>
                      <th className="w-4"></th>
                      <th className="text-left px-2 py-1 font-medium text-primary">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((r, i) => (
                      <tr key={i} className={`border-b last:border-0 ${r.changed ? "bg-green-50/50 dark:bg-green-950/10" : ""}`}>
                        <td className="px-2 py-1 text-muted-foreground">{r.rowIndex + 1}</td>
                        <td className="px-2 py-1 font-mono text-muted-foreground truncate max-w-[80px]" title={r.before}>{r.before || "—"}</td>
                        <td className="text-center"><ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50 mx-auto" /></td>
                        <td className={`px-2 py-1 font-mono truncate max-w-[80px] ${r.changed ? "text-green-700 dark:text-green-400 font-semibold" : "text-muted-foreground"}`} title={r.after}>
                          {r.after || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Function code (collapsed) */}
          <details className="pl-5">
            <summary className="text-[9px] text-muted-foreground cursor-pointer hover:text-foreground">Show generated code</summary>
            <pre className="mt-1 p-2 rounded bg-muted/50 text-[9px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
              {plan.functionBody}
            </pre>
          </details>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1 pl-5">
            <Button
              onClick={handleExecute}
              disabled={executing || !builtFn}
              size="sm"
              className="h-7 text-[10px] gap-1.5 px-3"
            >
              {executing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              {executing ? "Running..." : `Apply to ${preview?.totalAffected ?? selectedRowIds.size} row${(preview?.totalAffected ?? selectedRowIds.size) !== 1 ? "s" : ""}`}
            </Button>
            <Button
              onClick={handleCancel}
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] gap-1 px-2"
              disabled={executing}
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
