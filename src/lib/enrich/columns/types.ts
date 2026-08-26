import type {
  CategoryItem,
  ImageUrl,
  SessionKind,
  SourceUrl,
} from "@/types";
import type { EnrichColumnConfig } from "../types";

/**
 * What a column needs from the web_search tool. The tool policy is the union
 * of the needs of every enabled column.
 */
export interface ColumnNeeds {
  /** Column cannot be written reliably without searching the web. */
  search?: boolean;
  /** Column consumes image results (forces image content type). */
  images?: boolean;
  /** Column consumes source citations. */
  sources?: boolean;
  /** Column must be validated against the store category allowlist. */
  categoryAllowlist?: boolean;
}

/**
 * Everything a column spec may read while building its prompt section, its
 * schema property, or while parsing the model's answer for that column.
 */
export interface SpecContext {
  kind: SessionKind;
  /** The user's config for this column, defaults already applied. */
  col: EnrichColumnConfig;
  language: string;
  cmsType?: string;
  workspaceCategories?: CategoryItem[];
  categoriesRawRows?: Record<string, string>[];
  hasStoreAllowlist: boolean;
  /** Original row fields, used e.g. to exclude a page from its own links. */
  rowData: Record<string, string>;
  /**
   * The model's full answer for this row, so a column can be validated against
   * its siblings (e.g. secondary keywords must not repeat the target keyword).
   * Only populated at parse time.
   */
  selection?: Record<string, unknown>;
  /** Validated tool output; only populated at parse time. */
  toolImages?: ImageUrl[];
  toolSources?: SourceUrl[];
}

/**
 * One output column, self-contained: its prompt wording, its JSON schema
 * property, and how to sanitize what the model returns for it.
 *
 * Adding a column means adding one file and one registry entry — no edits to
 * the shared prompt / schema / parse plumbing.
 */
export interface ColumnSpec {
  id: string;
  /** Session kinds this column is offered in. */
  kinds: SessionKind[];
  needs?: ColumnNeeds;
  /** JSON schema property describing this column's expected output shape. */
  buildSchemaProperty(ctx: SpecContext): Record<string, unknown>;
  /** One line (or short block) under "Columns to fill". */
  buildPromptSection(ctx: SpecContext): string | null;
  /**
   * Long trailing block appended after the row data, for columns that need
   * bulk reference material such as a category allowlist.
   */
  buildPromptAppendix?(ctx: SpecContext): string | null;
  /** Sanitize / clamp the raw model value into what gets stored. */
  parseValue(raw: unknown, ctx: SpecContext): unknown;
}
