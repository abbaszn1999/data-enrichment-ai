"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  ArrowRight,
  StickyNote,
  Zap,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspaceContext } from "../../layout";
import {
  createImportSession,
  getEnrichmentPresets,
  updateImportSession,
} from "@/lib/supabase";
import { uploadWorkspaceFile } from "@/lib/supabase-storage";
import { saveProjectJson, saveSuppliersJson, loadSuppliersJson, type ProjectJson, type ProjectRow, type SupplierJson } from "@/lib/storage-helpers";
import { parseExcelFile } from "@/lib/excel";
import { ImportStepper } from "@/components/import/import-stepper";
import type { EnrichmentPreset } from "@/types";

export default function NewImportPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.workspaceSlug as string;
  const { workspace } = useWorkspaceContext();

  const [sessionName, setSessionName] = useState("");
  const [supplier, setSupplier] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<{ columns: string[]; rows: Record<string, string>[]; totalRows: number } | null>(null);
  const [fullRows, setFullRows] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [presets, setPresets] = useState<EnrichmentPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");


  // Load suppliers from Storage
  const loadSuppliers = useCallback(async () => {
    if (!workspace || suppliersLoaded) return;
    const data = await loadSuppliersJson(workspace.id);
    setSuppliers(data);
    setSuppliersLoaded(true);
  }, [workspace, suppliersLoaded]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    if (!workspace?.id) return;
    getEnrichmentPresets(workspace.id)
      .then(setPresets)
      .catch(console.error);
  }, [workspace?.id]);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    if (!sessionName) {
      const name = selectedFile.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      setSessionName(name.charAt(0).toUpperCase() + name.slice(1));
    }

    try {
      const buffer = await selectedFile.arrayBuffer();
      const parsed = await parseExcelFile(buffer);
      if (parsed && parsed.rows.length > 0) {
        // Store all rows for import_rows insertion
        const allRows = parsed.rows.map((r) => {
          const obj: Record<string, any> = {};
          for (const col of parsed.columns) {
            obj[col] = r.originalData[col] ?? "";
          }
          return obj;
        });
        setFullRows(allRows);
        setFileData({
          columns: parsed.columns,
          rows: allRows.slice(0, 3),
          totalRows: parsed.rows.length,
        });
      }
    } catch (err) {
      console.error("Failed to parse file:", err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleSubmit = async () => {
    if (!workspace || !sessionName || !file || !fileData) return;
    setLoading(true);

    try {
      // 1. Upload original file to storage (backup)
      await uploadWorkspaceFile(workspace.id, "supplier", file, file.name);

      // 2. Handle supplier (save to suppliers.json in Storage)
      let supplierName: string | undefined;
      if (supplier === "__new__" && newSupplierName.trim()) {
        supplierName = newSupplierName.trim();
        const existing = await loadSuppliersJson(workspace.id);
        const newSupplier: SupplierJson = {
          id: crypto.randomUUID(),
          name: supplierName,
          createdAt: new Date().toISOString(),
        };
        await saveSuppliersJson(workspace.id, [...existing, newSupplier]);
      } else if (supplier && supplier !== "__new__") {
        const existing = await loadSuppliersJson(workspace.id);
        supplierName = existing.find((s) => s.id === supplier)?.name;
      }

      // 3. Create import session in DB (metadata only)
      const session = await createImportSession(workspace.id, {
        name: sessionName.trim(),
        notes: notes.trim(),
        total_rows: fileData.totalRows,
      });

      // 4. Build project JSON and save to Storage
      const projectRows: ProjectRow[] = fullRows.map((row, index) => ({
        id: crypto.randomUUID(),
        rowIndex: index,
        status: "pending" as const,
        originalData: row,
        enrichedData: {},
        matchType: "new" as const,
      }));

      const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
      const presetSourceColumns = selectedPreset
        ? selectedPreset.settings.sourceColumns.filter((col) => fileData.columns.includes(col))
        : null;

      const projectJson: ProjectJson = {
        columns: fileData.columns,
        rows: projectRows,
        sourceColumns: presetSourceColumns?.length ? presetSourceColumns : [...fileData.columns],
        enrichmentColumns: selectedPreset ? selectedPreset.settings.enrichmentColumns : [],
        enrichmentSettings: selectedPreset ? selectedPreset.settings.enrichmentSettings : {},
        columnVisibility: {},
      };

      const storagePath = await saveProjectJson(workspace.id, session.id, projectJson);

      // 5. Update session with storage path
      await updateImportSession(session.id, {
        storage_path: storagePath,
      } as any);

      // Navigate to matching rules page
      router.push(`/w/${slug}/import/${session.id}/rules`);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || err?.error_description || JSON.stringify(err);
      alert(msg || "Failed to create catalog intelligence project");
      setLoading(false);
    }
  };


  return (
    <div className="min-h-full bg-gradient-to-b from-muted/20 via-background to-background">
      <div className="mx-auto max-w-7xl space-y-6 p-5 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">New catalog intelligence project</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Upload a supplier worksheet to start matching and enrichment.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 self-start shadow-sm sm:self-auto"
            onClick={() => router.push(`/w/${slug}/import`)}
          >
            Back to projects
          </Button>
        </header>

        <section className="overflow-hidden rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <ImportStepper currentStep={1} />
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Main Form */}
          <div className="space-y-4 lg:col-span-2">
            <section className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
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
                  className="h-10 w-full rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select supplier or type new...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  <option value="__new__">+ New Supplier</option>
                </select>
                {supplier === "__new__" && (
                  <Input
                    placeholder="Enter new supplier name"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    className="mt-2 h-9"
                  />
                )}
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <StickyNote className="h-3 w-3" /> Notes{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes about this project..."
                  rows={2}
                  className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs font-medium">
                  <Zap className="h-3 w-3" /> AI Enrichment Settings
                </Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPresetId("")}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      selectedPresetId === ""
                        ? "border-primary/50 bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="text-xs font-semibold">New settings</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      Start with default enrichment settings
                    </div>
                  </button>
                  <select
                    value={selectedPresetId}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    disabled={presets.length === 0}
                    className="h-[62px] w-full rounded-lg border bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-60"
                  >
                    <option value="">
                      {presets.length === 0
                        ? "No saved settings yet"
                        : "Choose saved setting..."}
                    </option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* File Upload */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Supplier File</Label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".xlsx,.xls,.csv";
                    input.onchange = (e) => {
                      const f = (e.target as HTMLInputElement).files?.[0];
                      if (f) handleFileSelect(f);
                    };
                    input.click();
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : file
                        ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10"
                        : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  {file ? (
                    <>
                      <FileSpreadsheet className="h-10 w-10 text-green-600" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-400">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Click to change file
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-10 w-10 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Drag & drop or click to browse
                      </span>
                      <span className="text-[10px] text-muted-foreground/60">
                        .xlsx, .xls, .csv (max 50MB)
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* File Quality + Stats */}
              {fileData && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                      <div className="text-sm font-bold">{fileData.totalRows}</div>
                      <div className="text-[9px] text-muted-foreground">Rows</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                      <div className="text-sm font-bold">
                        {fileData.columns.length}
                      </div>
                      <div className="text-[9px] text-muted-foreground">Columns</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                      <div className="text-sm font-bold">UTF-8</div>
                      <div className="text-[9px] text-muted-foreground">Encoding</div>
                    </div>
                  </div>

                  {fileData.rows.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">
                        Preview (first {fileData.rows.length} rows)
                      </Label>
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-muted/50">
                              {fileData.columns.map((col) => (
                                <th
                                  key={col}
                                  className="whitespace-nowrap px-3 py-1.5 text-left font-semibold"
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {fileData.rows.map((row, i) => (
                              <tr key={i} className="border-t">
                                {fileData.columns.map((col) => (
                                  <td
                                    key={col}
                                    className="whitespace-nowrap px-3 py-1.5"
                                  >
                                    {row[col] || ""}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              <Button
                onClick={handleSubmit}
                disabled={!sessionName || !file || !fileData || loading}
                className="h-10 w-full gap-2"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {loading ? "Processing file..." : "Continue to Matching Rules"}
              </Button>
            </section>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            {suppliers.length > 0 && (
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold">
                  <Users className="h-3.5 w-3.5" /> Recent Suppliers
                </h3>
                <div className="space-y-2">
                  {suppliers.slice(0, 3).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSupplier(s.id)}
                      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                        supplier === s.id
                          ? "border-primary/40 bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="text-[11px] font-medium">{s.name}</div>
                      <div className="mt-0.5 flex items-center gap-3 text-[9px] text-muted-foreground">
                        <span>{s.import_count} projects</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <Zap className="h-3.5 w-3.5 text-primary" /> Quick Tips
              </h3>
              <div className="space-y-2 text-[10px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-primary">1.</span>
                  <span>
                    Include a <strong>SKU</strong> or <strong>Part Number</strong>{" "}
                    column for best matching
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-primary">2.</span>
                  <span>
                    Headers should be in the <strong>first row</strong>
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-primary">3.</span>
                  <span>
                    Supported: <strong>.xlsx, .xls, .csv</strong>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
