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

/** A value typed once in the wizard (not a column), e.g. a link from the store. */
export type ExportPlatformSetting = {
  id: string;
  label: string;
  placeholder?: string;
  hint?: string;
  /** Returns an error message, or null when the value can be used. */
  validate?: (value: string) => string | null;
};

/** What a file does in the store: its fields, mapping guess and caveats. */
export type ExportPlatformFieldSet = {
  fields: ExportPlatformField[];
  /** Typed values the export needs besides the column mapping. */
  settings?: ExportPlatformSetting[];
  guessMapping: (columns: MappableColumn[]) => PlatformMapping;
  /** Shown under the mapping, e.g. how long image links stay valid. */
  note?: string;
};

/**
 * "products" creates or updates whole products; "images" only adds pictures;
 * "description" writes a generated description and the pictures it shows;
 * "description_files" writes the description only, its pictures go in a ZIP.
 */
export type ExportMode = "products" | "images" | "description" | "description_files";

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
