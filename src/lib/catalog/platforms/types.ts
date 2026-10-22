/**
 * A store platform the catalog can be exported for. Each platform has a fixed
 * set of import fields; the user maps sheet columns onto them.
 */
export type ExportPlatformField = {
  id: string;
  label: string;
  required?: boolean;
  /** One line shown under the field in the mapping step. */
  hint?: string;
};

export type MappableColumn = { key: string; label: string };

/** Field id → chosen column key ("" or missing = not included). */
export type PlatformMapping = Record<string, string>;

export type ExportPlatformOption = {
  id: string;
  title: string;
  description: string;
  fields: ExportPlatformField[];
  guessMapping: (columns: MappableColumn[]) => PlatformMapping;
  /** Shown under the mapping, e.g. how long image links stay valid. */
  note?: string;
};
