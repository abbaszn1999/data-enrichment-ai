"use client";

import { useCallback, useState } from "react";
import { Upload, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseExcelFile } from "@/lib/excel";
import { useSheetStore } from "@/store/sheet-store";

export function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setFile, fileName } = useSheetStore();

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setIsLoading(true);

      try {
        if (
          !file.name.endsWith(".xlsx") &&
          !file.name.endsWith(".xls") &&
          !file.name.endsWith(".csv")
        ) {
          throw new Error("Please upload an Excel file (.xlsx, .xls) or CSV file.");
        }

        const buffer = await file.arrayBuffer();
        const { columns, rows } = await parseExcelFile(buffer);
        setFile(file.name, columns, rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file");
      } finally {
        setIsLoading(false);
      }
    },
    [setFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  if (fileName) return null;

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-xl p-0">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            relative flex flex-col items-center justify-center gap-4 p-12
            border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer
            ${
              isDragging
                ? "border-primary bg-primary/5 scale-[1.02]"
                : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
            }
            ${isLoading ? "opacity-50 pointer-events-none" : ""}
          `}
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div
            className={`
            p-4 rounded-full transition-colors
            ${isDragging ? "bg-primary/10" : "bg-muted"}
          `}
          >
            {isLoading ? (
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : (
              <Upload
                className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
              />
            )}
          </div>

          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">
              {isLoading ? "Parsing file..." : "Upload Product Data"}
            </h3>
            <p className="text-sm text-muted-foreground">
              Drag & drop your Excel file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground/60">
              Supports .xlsx, .xls, and .csv files
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
            <FileSpreadsheet className="h-4 w-4" />
            <span>Your data stays in the browser until enrichment</span>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
            <X className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </Card>
    </div>
  );
}
