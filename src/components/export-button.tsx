"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSheetStore } from "@/store/sheet-store";
import { exportToExcel } from "@/lib/excel";

export function ExportButton() {
  const { rows, originalColumns, enrichmentColumns, fileName, isEnriching } =
    useSheetStore();

  const doneCount = rows.filter((r) => r.status === "done").length;

  const handleExport = async () => {
    if (doneCount === 0) return;

    const blob = await exportToExcel(
      rows,
      originalColumns,
      enrichmentColumns,
      fileName || "export"
    );

    const baseName = (fileName || "export").replace(/\.[^/.]+$/, "");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}_enriched.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Excel exported", { description: `${doneCount} enriched rows exported` });
  };

  if (doneCount === 0) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleExport}
      disabled={isEnriching}
      className="gap-1 text-xs flex-1"
    >
      <Download className="h-3.5 w-3.5" />
      Export ({doneCount})
    </Button>
  );
}
