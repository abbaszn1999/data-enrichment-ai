import type {
  VisualizerProjectSettings,
  VisualizerRow,
} from "@/lib/visualizer/types";

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
    product.productImage = String(
      row.originalData[settings.productImageColumn] ?? ""
    ).trim();
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
  columns: string[]
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
  return null;
}

/** @deprecated Use validateVisualizerSettings */
export function validateDescriptionMapping(
  settings: VisualizerProjectSettings,
  columns: string[]
): string | null {
  return validateVisualizerSettings(settings, columns);
}
