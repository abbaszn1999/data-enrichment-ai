import { listColumnsWithHttpUrls, parseImageUrls } from "@/lib/gallery/image-urls";
import type {
  VisualizerProjectSettings,
  VisualizerRow,
} from "@/lib/visualizer/types";

export const VISUALIZER_IMAGE_COLUMN_ERROR =
  "Product image column must contain http(s) image URLs";

const IMAGE_COLUMN_SAMPLE = {
  sampleSize: 40,
  minUrlShare: 0.25,
} as const;

export function visualizerUrlImageColumns(
  columns: string[],
  rows: Array<{ originalData?: Record<string, string> }>
): string[] {
  return listColumnsWithHttpUrls({
    columns,
    rows,
    ...IMAGE_COLUMN_SAMPLE,
  });
}

/** Dropdown options: URL-valued columns, keeping a saved pick visible. */
export function visualizerImageColumnOptions(params: {
  columns: string[];
  rows: Array<{ originalData?: Record<string, string> }>;
  selected?: string | null;
}): string[] {
  const detected = visualizerUrlImageColumns(params.columns, params.rows);
  const selected = params.selected?.trim();
  if (
    selected &&
    params.columns.includes(selected) &&
    !detected.includes(selected)
  ) {
    return [selected, ...detected];
  }
  return detected;
}

/** Build product context from selected worksheet columns. */
export function mappedProductFields(
  row: VisualizerRow,
  settings: Pick<VisualizerProjectSettings, "selectedColumns" | "productImageColumn">
): Record<string, string> {
  const selected = settings.selectedColumns.length
    ? settings.selectedColumns
    : Object.keys(row.originalData);
  const product: Record<string, string> = {};
  for (const column of selected) {
    const value = String(row.originalData[column] ?? "").trim();
    if (value) product[column] = value;
  }
  if (settings.productImageColumn) {
    const urls = parseImageUrls(
      row.originalData[settings.productImageColumn]
    );
    if (urls[0]) product.productImage = urls[0];
  }
  return product;
}

export function productDisplayName(
  row: VisualizerRow,
  settings: Pick<VisualizerProjectSettings, "selectedColumns">
): string {
  const selected = settings.selectedColumns.length
    ? settings.selectedColumns
    : Object.keys(row.originalData);
  for (const column of selected) {
    const value = String(row.originalData[column] ?? "").trim();
    if (value && !/^https?:\/\//i.test(value)) return value;
  }
  return `Row ${row.rowIndex + 1}`;
}

export function validateVisualizerSettings(
  settings: VisualizerProjectSettings,
  columns: string[],
  rows: Array<{ originalData?: Record<string, string> }> = []
): string | null {
  if (settings.selectedColumns.length === 0) {
    return "Select at least one worksheet column before generating";
  }
  if (
    settings.selectedColumns.some((column) => !columns.includes(column))
  ) {
    return "One or more selected columns are missing from the worksheet";
  }
  if (!settings.productImageColumn) {
    return "Choose a Product image column before generating";
  }
  if (!columns.includes(settings.productImageColumn)) {
    return "Product image column is missing from the worksheet";
  }
  if (
    !visualizerUrlImageColumns(columns, rows).includes(
      settings.productImageColumn
    )
  ) {
    return VISUALIZER_IMAGE_COLUMN_ERROR;
  }
  return null;
}

/** @deprecated Use validateVisualizerSettings */
export function validateDescriptionMapping(
  settings: VisualizerProjectSettings,
  columns: string[]
): string | null {
  return validateVisualizerSettings(settings, columns);
}
