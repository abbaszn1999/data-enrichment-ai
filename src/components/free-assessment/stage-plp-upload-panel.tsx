"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  downloadAssessmentTemplate,
  parseAssessmentCsv,
  type AssessmentPlpRow,
} from "./assessment-csv";

type StagePlpUploadPanelProps = {
  onRows: (rows: AssessmentPlpRow[], fileName: string) => void | Promise<void>;
  readOnly?: boolean;
  busy?: boolean;
  error?: string | null;
};

export function StagePlpUploadPanel({
  onRows,
  readOnly = false,
  busy: busyProp = false,
  error: errorProp = null,
}: StagePlpUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const busy = busyProp || parsing;
  const error = errorProp ?? parseError;

  const ingestFile = async (file: File) => {
    setParseError(null);
    setParsing(true);
    try {
      const text = await file.text();
      const rows = parseAssessmentCsv(text);
      setFileName(file.name);
      await onRows(rows, file.name);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read that sheet.");
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">
          Upload your PLP sheet
        </h2>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
          No store connection on this assessment. Upload every collection, category,
          and brand page you already have — name, page type, and SKU count. The
          same niche → catalog → seeds flow runs from that list.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={downloadAssessmentTemplate}
        >
          <Download className="h-3.5 w-3.5" />
          Download example template
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Columns: <span className="font-medium text-foreground/80">plp_name</span>,{" "}
          <span className="font-medium text-foreground/80">page_type</span>,{" "}
          <span className="font-medium text-foreground/80">sku_count</span>,{" "}
          <span className="font-medium text-foreground/80">description</span>
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={readOnly || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void ingestFile(file);
        }}
      />

      <button
        type="button"
        disabled={readOnly || busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!readOnly) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void ingestFile(file);
        }}
        className={cn(
          "flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border/80 bg-muted/20 hover:border-primary/40 hover:bg-muted/40",
          (readOnly || busy) && "pointer-events-none opacity-70"
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Upload className="h-5 w-5" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {parsing
              ? "Reading sheet…"
              : busyProp
                ? "Analyzing catalog with AI…"
                : "Drop a CSV here, or click to upload"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {fileName ?? "CSV only · one row per PLP"}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] text-muted-foreground">
          <FileSpreadsheet className="h-3 w-3" />
          .csv
        </span>
      </button>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          After upload, the agent analyzes your sheet and groups every PLP into parent
          niches. Push to store and product preview stay off in this assessment.
        </p>
      )}
    </div>
  );
}
