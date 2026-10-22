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

/** What a file does in the store: its fields, mapping guess and caveats. */
export type ExportPlatformFieldSet = {
  fields: ExportPlatformField[];
  guessMapping: (columns: MappableColumn[]) => PlatformMapping;
  /** Shown under the mapping, e.g. how long image links stay valid. */
  note?: string;
};

/** "products" creates or updates whole products; "images" only adds pictures. */
export type ExportMode = "products" | "images";

export type ExportPlatformMode = ExportPlatformFieldSet & {
  id: ExportMode;
  title: string;
  description: string;
};

export type ExportPlatformOption = ExportPlatformFieldSet & {
  id: string;
  title: string;
  description: string;
  /** Choices shown above the mapping; the first is the default. Omitted = "products" only. */
  modes?: ExportPlatformMode[];
};
