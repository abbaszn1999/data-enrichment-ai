export const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  products: {
    maxBytesXlsx: 25 * MB,
    maxBytesCsv: 50 * MB,
    maxRows: 50_000,
    depth: null as number | null,
  },
  categories: {
    maxBytesXlsx: 10 * MB,
    maxBytesCsv: 20 * MB,
    maxRows: 5_000,
    depth: 6,
  },
  catalogIntelligence: {
    maxBytesXlsx: 30 * MB,
    maxBytesCsv: 60 * MB,
    maxRows: 25_000,
    depth: null as number | null,
  },
  gallery: {
    maxBytesXlsx: 20 * MB,
    maxBytesCsv: 20 * MB,
    maxRows: 5_000,
    depth: null as number | null,
  },
  visualizer: {
    maxBytesXlsx: 20 * MB,
    maxBytesCsv: 20 * MB,
    maxRows: 1_000,
    depth: null as number | null,
  },
} as const;

export type UploadKind = keyof typeof UPLOAD_LIMITS;

const SPREADSHEET_EXT = /\.(xlsx|xls|csv)$/i;

export class UploadLimitError extends Error {
  readonly code = "upload_limit_exceeded";

  constructor(message: string) {
    super(message);
    this.name = "UploadLimitError";
  }
}

export function spreadsheetKind(fileName: string): "xlsx" | "csv" | "invalid" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsm")) return "invalid";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  return "invalid";
}

export function maxBytesFor(kind: UploadKind, fileName: string): number {
  const type = spreadsheetKind(fileName);
  const limits = UPLOAD_LIMITS[kind];
  if (type === "csv") return limits.maxBytesCsv;
  return limits.maxBytesXlsx;
}

export function assertSpreadsheetFile(
  file: { name: string; size: number },
  kind: UploadKind
): void {
  if (!SPREADSHEET_EXT.test(file.name) || spreadsheetKind(file.name) === "invalid") {
    throw new UploadLimitError(
      "Upload an XLSX, XLS, or CSV file. Macro-enabled workbooks (.xlsm) are not allowed."
    );
  }
  if (file.size <= 0) {
    throw new UploadLimitError("The file is empty.");
  }
  const maxBytes = maxBytesFor(kind, file.name);
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / MB);
    throw new UploadLimitError(
      `File is too large. Maximum for this upload is ${mb} MB.`
    );
  }
}

export function assertRowCount(count: number, kind: UploadKind): void {
  const max = UPLOAD_LIMITS[kind].maxRows;
  if (count > max) {
    throw new UploadLimitError(
      `This file has ${count.toLocaleString()} rows. Maximum for this upload is ${max.toLocaleString()}.`
    );
  }
}
