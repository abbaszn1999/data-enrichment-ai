import { getPlatformFormat, type PlatformFormat } from "./export-formats";

export function transformValue(value: any, transform: string): string {
  const str = String(value ?? "");

  switch (transform) {
    case "html_wrap":
      return str ? `<p>${str}</p>` : "";
    case "join_comma":
      return Array.isArray(value) ? value.join(", ") : str;
    case "join_newline":
      return Array.isArray(value) ? value.join("\n") : str;
    case "join_pipe":
      return Array.isArray(value) ? value.join(" | ") : str;
    case "first_item":
      return Array.isArray(value) ? (value[0] || "") : str;
    case "first_image":
      return Array.isArray(value) ? (value[0] || "") : str;
    case "all_images":
      return Array.isArray(value) ? value.join(", ") : str;
    case "strip_html":
      return str.replace(/<[^>]*>/g, "");
    default:
      if (transform?.startsWith("truncate_")) {
        const n = parseInt(transform.split("_")[1], 10);
        return str.slice(0, n);
      }
      return str;
  }
}

export function generateExportData(
  products: { data: Record<string, any>; enriched_data?: Record<string, any> }[],
  platformId: string,
  customMapping?: Record<string, string>,
  includeEnriched = true
): Record<string, string>[] {
  const format = getPlatformFormat(platformId);
  if (!format) return [];

  const rows: Record<string, string>[] = [];

  for (const product of products) {
    const combined = {
      ...product.data,
      ...(includeEnriched ? product.enriched_data || {} : {}),
    };

    const row: Record<string, string> = {};

    if (format.columns.length === 0) {
      // Generic: export all fields
      for (const [key, val] of Object.entries(combined)) {
        row[key] = String(val ?? "");
      }
    } else {
      for (const col of format.columns) {
        const mapping = customMapping?.[col.platformField] || col.defaultSystemField;
        let value = "";

        if (mapping && combined[mapping] !== undefined) {
          value = col.transform
            ? transformValue(combined[mapping], col.transform)
            : String(combined[mapping] ?? "");
        } else if (col.defaultValue) {
          value = col.defaultValue;
        }

        row[col.platformField] = value;
      }
    }

    rows.push(row);
  }

  return rows;
}

export function generateCSV(data: Record<string, string>[], delimiter = ","): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const lines: string[] = [];

  // Header row
  lines.push(headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(delimiter));

  // Data rows
  for (const row of data) {
    lines.push(
      headers
        .map((h) => {
          const val = row[h] ?? "";
          return `"${val.replace(/"/g, '""')}"`;
        })
        .join(delimiter)
    );
  }

  return lines.join("\n");
}

export async function generateXLSX(data: Record<string, string>[]): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

export function downloadBlob(content: string | ArrayBuffer, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportProducts(
  products: { data: Record<string, any>; enriched_data?: Record<string, any> }[],
  platformId: string,
  options?: {
    customMapping?: Record<string, string>;
    includeEnriched?: boolean;
    fileName?: string;
  }
) {
  const format = getPlatformFormat(platformId);
  if (!format) return;

  const data = generateExportData(
    products,
    platformId,
    options?.customMapping,
    options?.includeEnriched ?? true
  );

  const baseName = options?.fileName || `export_${platformId}_${new Date().toISOString().slice(0, 10)}`;

  switch (format.fileFormat) {
    case "csv": {
      const csv = generateCSV(data);
      downloadBlob(csv, `${baseName}.csv`, "text/csv");
      break;
    }
    case "tsv": {
      const tsv = generateCSV(data, "\t");
      downloadBlob(tsv, `${baseName}.tsv`, "text/tab-separated-values");
      break;
    }
    case "xlsx": {
      const xlsx = await generateXLSX(data);
      downloadBlob(xlsx, `${baseName}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      break;
    }
  }
}
