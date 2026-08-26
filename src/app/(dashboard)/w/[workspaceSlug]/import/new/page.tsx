"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "motion/react";
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
    <div className="autommerce-dashboard min-h-full bg-background [font-family:var(--brand-font)]">
      <section className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-[#400095]/[0.08] via-background to-[#F76D01]/[0.08]">
        <div className="absolute -left-20 -top-28 h-64 w-64 rounded-full bg-[#400095]/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-16 h-64 w-64 rounded-full bg-[#F76D01]/10 blur-3xl" />
        <div className="relative mx-auto max-w-[1500px] px-5 py-7 sm:px-7 lg:px-10">
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#400095] text-white shadow-[0_8px_25px_rgba(64,0,149,.22)] dark:bg-[#F76D01]">
                <Upload className="h-4 w-4" />
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.24em] text-[#400095] dark:text-[#F76D01]">
                Step 01 · Source intake
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-[-0.035em]">New catalog intelligence project</h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Define the source, choose your enrichment intelligence, and validate the worksheet before matching begins.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 self-start rounded-xl border-border/60 bg-background/70 text-[10px] backdrop-blur sm:self-auto"
            onClick={() => router.push(`/w/${slug}/import`)}
          >
            Back to projects
          </Button>
        </motion.header>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-5 p-5 sm:p-7 lg:p-10">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="overflow-hidden rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4"
        >
          <ImportStepper currentStep={1} />
        </motion.section>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Main Form */}
          <div className="space-y-4 lg:col-span-2">
            <motion.section
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="relative space-y-5 overflow-hidden rounded-[24px] border border-border/60 bg-card p-5 shadow-[0_15px_50px_rgba(15,23,42,.05)] sm:p-6"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#F76D01] via-[#C40000] to-[#400095]" />
              {/* Session Name */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Session Name</Label>
                <Input
                  placeholder="e.g. Samsung Q3 Shipment"
                  value={sessionName}
                  onChange={(e) => setSessionName(e.target.value)}
                  className="h-10 rounded-xl bg-muted/35"
                />
              </div>

              {/* Supplier */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Supplier</Label>
                <select
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border/60 bg-muted/35 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B358D]/25"
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
                    className="mt-2 h-9 rounded-xl"
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
                  className="w-full resize-none rounded-xl border border-border/60 bg-muted/35 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B358D]/25"
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
                        ? "border-[#400095]/40 bg-[#400095]/5 dark:border-[#F76D01]/40 dark:bg-[#F76D01]/5"
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
                    className="h-[62px] w-full rounded-xl border border-border/60 bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#6B358D]/25 disabled:opacity-60"
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
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 transition-all ${
                    isDragging
                      ? "border-[#400095] bg-[#400095]/5 dark:border-[#F76D01] dark:bg-[#F76D01]/5"
                      : file
                        ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10"
                        : "border-muted-foreground/20 bg-muted/20 hover:border-[#6B358D]/50 hover:bg-[#400095]/[0.03]"
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
                className="h-11 w-full gap-2 rounded-xl bg-[#400095] text-white shadow-[0_10px_26px_rgba(64,0,149,.2)] hover:bg-[#6B358D] dark:bg-[#F76D01] dark:hover:bg-[#F76D01]/90"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {loading ? "Processing file..." : "Continue to Matching Rules"}
              </Button>
            </motion.section>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            {suppliers.length > 0 && (
              <motion.section initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
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
              </motion.section>
            )}

            <motion.section initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 }} className="rounded-2xl border border-[#6B358D]/20 bg-gradient-to-br from-[#400095]/[0.06] to-[#F76D01]/[0.04] p-4 shadow-sm">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <Zap className="h-3.5 w-3.5 text-[#6B358D] dark:text-[#F76D01]" /> Quick Tips
              </h3>
              <div className="space-y-2 text-[10px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-[#6B358D] dark:text-[#F76D01]">1.</span>
                  <span>
                    Include a <strong>SKU</strong> or <strong>Part Number</strong>{" "}
                    column for best matching
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-[#6B358D] dark:text-[#F76D01]">2.</span>
                  <span>
                    Headers should be in the <strong>first row</strong>
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-[#6B358D] dark:text-[#F76D01]">3.</span>
                  <span>
                    Supported: <strong>.xlsx, .xls, .csv</strong>
                  </span>
                </div>
              </div>
            </motion.section>
          </div>
        </div>
      </main>
    </div>
  );
}
