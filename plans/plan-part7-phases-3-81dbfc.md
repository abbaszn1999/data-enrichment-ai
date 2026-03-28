# Part 7: Phase 3A (Supplier Import), 3B (Matching Engine), 3C (Review & Enrich)

Detailed implementation tasks for the core supplier import workflow.

> **⚠️ UPDATED** — Column Mapping has been removed as a separate step. It is now handled as an AI auto-preview in the New Import page. The import flow is now 3 steps: Matching Rules → Review Results → Enrichment Tool. The Review page now supports approve/reject per row, diff visualization with trend arrows, bulk actions, impact summary, and big change alerts. The Matching Rules page now has presets, drag reorder, test-a-SKU, and AI suggestions. **Old `projects`/`rows` tables DELETED** — enrichment tool reads `import_rows` directly at `/w/[slug]/import/[id]/enrich`. No more `createProject` or `/project/[id]`.

---

## Phase 3A: Supplier Import (No Separate Column Mapping Step)

### Goal
Upload supplier sheet with AI auto-detection of column mapping, quality checks, duplicate detection, and notes. Column mapping is shown as a preview — not a separate step.

### Prerequisites
- Phase 2A complete (master products + categories exist)
- Phase 2B complete (storage works)
- Run supplier_profiles + import_sessions SQL (Part 2, Tables 8-9)
- Run RLS policies (Part 3)

### Tasks

#### 3A.1 — Supplier Profiles CRUD
**File**: `src/lib/supabase.ts` (EXPAND)
```
getSupplierProfiles(workspaceId)
getSupplierProfile(id)
createSupplierProfile(workspaceId, { name, defaultColumnMapping?, defaultMatchingRules?, defaultMatchColumn? })
updateSupplierProfile(id, updates)
deleteSupplierProfile(id)
incrementSupplierImportCount(id)
```

#### 3A.2 — Import Sessions CRUD
**File**: `src/lib/supabase.ts` (EXPAND)
```
getImportSessions(workspaceId, { status?, search?, sortBy? })
getImportSession(id)
createImportSession(workspaceId, { fileId, supplierId?, name, notes?, tags?, totalRows })
updateImportSession(id, updates)
deleteImportSession(id)
duplicateImportSession(id)
archiveImportSession(id)
```

#### 3A.3 — Import Sessions List Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/page.tsx`

Enhanced session list with:
- **Stats Bar**: 4 cards (Total Sessions, In Progress, Completed, Total Products)
- **Search**: by session name, supplier name, or tags
- **Sort**: Newest First, Oldest First, Most Products
- **Filter Tabs**: All | In Progress | Completed — with counts per tab
- **Session Cards**:
  - Session name + status badge with icon (color-coded per status)
  - Tags as colored badges (monthly, priority, urgent, quarterly)
  - Supplier name + row counts (total, existing, new, enriched)
  - Progress bar with percentage and stage description
  - Duration (for completed sessions)
  - Created time (relative) + created by
  - Completed summary: imported count, price changes, stock updates
- **Actions Menu** (on hover): Duplicate, Archive, Delete
- **Empty State**: when no sessions match search
- "New Import" button -> `/import/new`

#### 3A.4 — New Import Page (with AI Column Preview)
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/new/page.tsx`
**File**: `src/components/import/file-upload-step.tsx`
**File**: `src/components/import/ai-column-preview.tsx`

**3-column layout** (main form: 2 cols, sidebar: 1 col):

**Main Form:**
- Session Name (required, auto-filled from file name)
- Supplier (dropdown of existing + "New Supplier" option)
- Notes field (optional textarea)
- File Upload (drag-drop with visual states)

**After file upload, show:**
- **File Quality Stats**: 3 cards (Rows, Columns, Encoding)
- **Quality Checks**: green ✅ / amber ⚠️ for empty rows, empty cells, duplicates
- **Duplicate Detection Warning**: if similar file was recently imported, show amber alert
- **AI Column Mapping Preview** (collapsible):
  - Auto-detect column types (text, number, id)
  - Show each file column → suggested system field with confidence badge (95%+ green, 85%+ amber, <85% red)
  - User can view but not edit here (editing is done if needed in matching rules)
- **Preview Table**: first 3 rows of the file
- **Import Settings** (collapsible): Skip empty rows, Trim whitespace, Auto-detect encoding

**Right Sidebar:**
- **Recent Suppliers**: clickable cards with last used date and import count
- **Quick Tips**: numbered tips for best results
- **Your Import Stats**: total imports, products matched, avg match rate, last import

**On submit:**
1. Upload file to Storage `{ws_id}/supplier/{name}_{date}.xlsx`
2. Create uploaded_files record
3. Parse file to get columns + row count
4. Auto-detect column mapping via AI/smart rules → **deducts AI credits** (operation='ai_column_mapping', logged to `credit_transactions`)
5. Create import_session with status='matching' (skips 'mapping')
6. Save detected column_mapping to import_session
7. If existing supplier: pre-load saved matching rules
8. Navigate to `/import/{sessionId}/rules`

> **AI Credits**: Only step 4 (AI column mapping) consumes credits. All other steps (upload, parse, matching, review) are free.

#### 3A.5 — Import Stepper Component
**File**: `src/components/import/import-stepper.tsx`
- Horizontal step indicator showing workflow progress
- **3 Steps**: 1.Matching Rules -> 2.Review Results -> 3.Enrichment Tool
- Current step highlighted with primary color
- Completed steps have green checkmark
- Connector lines between steps (green for completed)
- Click completed step to go back

**AI Auto-Detect Column Mapping (built into New Import page):**
Uses smart detection rules + optional Gemini fallback:
```
Column name contains "sku" or "part" or "item code" or "model" -> SKU
Column name contains "name" or "title" or "description" -> Name
Column name contains "price" or "cost" or "msrp" -> Price
Column name contains "stock" or "qty" or "quantity" or "inventory" -> Stock
Column name contains "brand" or "manufacturer" or "vendor" -> Brand
Column name contains "category" or "type" or "class" -> Category
Column name contains "weight" -> Weight
```
Confidence is calculated based on name match + sample data type validation.
Results displayed as a preview — user can override if needed.

---

## Phase 3B: Matching Engine

### Goal
Compare supplier SKUs against master products using configurable rules. Split into existing vs new.

### Prerequisites
- Phase 3A complete (mapping done)
- Run import_rows SQL (Part 2, Table 10)

### Tasks

#### 3B.1 — Matching Library
**File**: `src/lib/matching.ts`

```typescript
// ── Rule Types ──────────────────────────────────────────
interface MatchingRule {
  type: string;
  enabled: boolean;
  value?: string;    // for ignore_prefix, ignore_suffix
  pattern?: string;  // for regex_extract
}

// Available rule types:
// "exact_match"      — Direct string comparison (always on, base case)
// "case_insensitive" — Compare lowercase versions
// "trim_whitespace"  — Remove leading/trailing spaces
// "ignore_prefix"    — Remove specific prefix string (e.g., "00")
// "ignore_suffix"    — Remove specific suffix string (e.g., "-NEW")
// "strip_non_alnum"  — Remove all non-alphanumeric characters
// "regex_extract"    — Extract matching portion via regex pattern
// "contains"         — Check if one SKU contains the other

// ── Core Functions ──────────────────────────────────────

// Apply all enabled rules to normalize a single value
function normalizeValue(value: string, rules: MatchingRule[]): string

// Build a lookup map from master products (normalized SKU -> product)
function buildMasterIndex(
  masterSkus: { id: string; sku: string }[],
  rules: MatchingRule[]
): Map<string, { id: string; sku: string }[]>

// Match supplier rows against master products
function matchSupplierRows(
  supplierRows: { rowIndex: number; sku: string; data: Record<string, any> }[],
  masterIndex: Map<string, { id: string; sku: string }[]>,
  rules: MatchingRule[]
): MatchResult[]

interface MatchResult {
  rowIndex: number;
  supplierSku: string;
  normalizedSku: string;
  matchType: 'existing' | 'new' | 'ambiguous';
  matchedProductId?: string;
  matchedProductSku?: string;
  confidence: number;      // 0.0 to 1.0
  allMatches?: { id: string; sku: string }[];  // for ambiguous
}

// Generate diff between supplier data and master product data
function generateDiff(
  supplierData: Record<string, any>,
  masterData: Record<string, any>,
  columnMapping: Record<string, string>  // supplier_col -> system_col
): Record<string, { old: string; new: string }>
```

#### 3B.2 — Matching API
**File**: `src/app/api/import/match/route.ts`
- POST: `{ sessionId }`
- Server-side execution (can be slow for large datasets)
- Steps:
  1. Load import_session (get column_mapping, matching_rules, supplier_match_column, master_match_column, target_category_ids)
  2. Load uploaded file data (from parsed upload or re-parse from Storage), extract values from `supplier_match_column`
  3. Load master products for this workspace using `master_match_column` (optionally filtered by `target_category_ids` — supports multiple categories)
  4. Run matching algorithm
  5. Create import_rows records with match_type set
  6. For "existing" rows: generate diff_data
  7. Update import_session counts (existing_count, new_count)
  8. Update session status to 'review'
- Returns: `{ existing: number, new: number, ambiguous: number }`

#### 3B.3 — Matching Rules Page (Step 1 of import flow)
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/rules/page.tsx`
**File**: `src/components/import/matching-rules-editor.tsx`
**File**: `src/components/import/rule-presets.tsx`
**File**: `src/components/import/match-preview.tsx`

**2-column layout** (rules config: 2 cols, preview results: 1 col):

**Left Side — Rules Configuration:**

**Match Configuration Card:**
- **Supplier Match Column** dropdown: lists all columns from the uploaded supplier file (from `import_sessions.column_mapping` keys, e.g. "Part Number", "Item Code", "Model Number"). Auto-selects the column mapped to SKU if available.
- **Master Match Column** dropdown: lists system columns from master_products (SKU, Barcode, Name). Default: SKU.
- **Category Filter** (optional, multi-select): dropdown with checkboxes to select one or more categories. Empty = match against all products. Selecting categories narrows the matching scope to products in those categories only. Shows selected count badge (e.g. "3 selected").

**Rule Presets Card:**
- 3 presets displayed as clickable cards:
  - **Samsung Format**: Prefix 00 + case insensitive
  - **Dell Format**: Trim + case insensitive + strip dashes
  - **Generic / Safe**: Trim whitespace + case insensitive
- Clicking a preset auto-configures the rules below
- Active preset is highlighted with primary border

**Rules List Card:**
- Active rules count badge in header
- Description: "Rules are applied in order to normalize SKU values. Drag to reorder."
- Each rule row has:
  - **Drag handle** (GripVertical icon) for reordering
  - **Checkbox toggle** (custom styled, primary color when active)
  - **Label + description** text
  - **Config input** (for ignore_prefix/suffix: text input, for regex: pattern input)
  - Active rules have primary background tint

| Rule | Toggle | Config | Description |
|------|--------|--------|-------------|
| Trim Whitespace | checkbox | — | Remove spaces from both sides |
| Case Insensitive | checkbox | — | Compare as lowercase |
| Ignore Prefix | checkbox | text input | Remove prefix (e.g., "00") |
| Ignore Suffix | checkbox | text input | Remove suffix (e.g., "-NEW") |
| Strip Non-Alphanumeric | checkbox | — | Remove dashes, spaces, slashes |
| Regex Extract | checkbox | pattern input | Extract matching portion |
| Contains Match | checkbox | — | Check if supplier SKU contains master SKU |

- Default: Trim Whitespace ON, Case Insensitive ON, rest OFF
- If supplier profile has saved rules: pre-load them

**Multi-Example Live Preview Table:**
- Shows 5 sample SKUs being transformed in real-time
- Columns: Supplier SKU | After Rules | Master SKU | Result (Match/New badge)
- Updates instantly as rules are toggled

**Test-a-SKU Card:**
- Text input + "Test" button (Enter key supported)
- Shows result: Input → Normalized → Matched/Not Found
- Match result with badge (green for match, amber for no match)

**Right Side — Preview Results:**

**"Preview Match Results" button** (full width, triggers simulated match)

After preview:
- **Match Quality Score**: large percentage with progress bar
- **Result Cards**: Existing (green), New (blue), Ambiguous (yellow) — with icons
- **Before/After Rule Impact Card**: "Without rules: 0 matches" → "With rules: X matches" + improvement count
- **Sample Matches Card**: list of supplier SKU → master SKU pairs
- **AI Suggestion Card**: primary-tinted card suggesting additional rules to improve match rate (e.g., "Enabling Strip Non-Alphanumeric could improve matches by 15%") with "Apply suggestion" link

**Confirm Button:**
- "Confirm & Review Results" button (disabled until preview is run)
- Save matching_rules to import_session
- Update supplier_profile default_matching_rules
- Run full matching (create import_rows)
- Navigate to `/import/{sessionId}/review`

---

## Phase 3C: Review & AI Enrichment

### Goal
Review matching results with approve/reject workflow. View diff visualization with impact analysis. Continue to enrichment tool for AI processing.

### Prerequisites
- Phase 3B complete (matching done, import_rows created)

### Tasks

#### 3C.1 — Review Page (Step 2 of import flow)
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/review/page.tsx`
**File**: `src/components/import/review-summary.tsx`
**File**: `src/components/import/review-table.tsx`

- Stepper at top (step 2 active)
- Header: session name + "Export Report" button
- Two tabs: "Existing" | "New" — as pill buttons with counts

**Summary Section:**

**6 Summary Cards** (grid, compact):
- Matched (green) — count of existing product matches
- New Products (blue) — count of new products
- Price Changes (amber) — count of products with price diffs
- Stock Changes (purple) — count of products with stock diffs
- Approved (green) — live count based on user selections
- Rejected (red) — live count based on user selections

**2 Impact Summary Cards** (larger):
- **Total Price Impact**: dollar amount with +/- and product count, colored (red for decrease, green for increase), DollarSign icon
- **Total Stock Change**: unit count with +/- and product count, colored, Package icon

**Big Change Alert** (conditional):
- Amber warning banner when products have >10% price changes
- Shows count of affected products
- "Review carefully before approving" message

#### 3C.2 — Existing Products Table (Diff View with Approve/Reject)

**Toolbar**: Search input + filter dropdown (All/Price/Stock) + Bulk Actions (Approve All, Reject All)

**Table columns:**
- Checkbox (approve/reject toggle per row)
- Matched SKU (with supplier SKU below in muted text)
- Field (capitalized field name: price, stock)
- Current Value (muted, right-aligned, monospace)
- Arrow icon (→)
- New Value (bold, monospace)
- Change (trend arrow + percentage, color-coded):
  - TrendingUp (green) for increases
  - TrendingDown (red) for decreases
  - AlertTriangle (amber) for big changes >10%
- Status badge: Approved (green with CheckCircle2) or Rejected (red with Ban)

**Row behavior:**
- Clicking checkbox toggles between approved/rejected
- Rejected rows get red background tint + reduced opacity
- Rows span multiple fields (using rowSpan for SKU and checkbox)

**Search**: filters by matched SKU or supplier SKU
**Filter**: All Changes | Price Only | Stock Only

#### 3C.3 — New Products Table (with Approve/Reject)

**Table columns:**
- Checkbox (approve/reject toggle)
- Supplier SKU (monospace, bold)
- Description
- Brand
- Price (right-aligned, monospace)
- Stock (right-aligned, monospace)
- Status badge (Approved/Rejected)

Same approve/reject behavior as existing products table.

#### 3C.4 — Bulk Actions
- **Approve All**: sets all rows (both tabs) to approved
- **Reject All**: sets all rows to rejected
- Footer shows live count: "X approved, Y rejected"

#### 3C.5 — Continue to Enrichment Tool
- "Continue to Enrichment Tool" button with Sparkles icon
- Only approved rows proceed to enrichment
- Loading state: "Opening Enrichment Tool..."
- Navigates to `/w/[slug]/import/[sessionId]/enrich` (NOT the old `/project/[id]`)
- The enrichment page reads directly from `import_rows` table (old `projects`/`rows` tables are DELETED)
- Features:
  - **Existing/New sheet toggle** in header
  - Existing sheet shows approved updates (read-only confirmation)
  - New sheet shows products for AI enrichment

#### 3C.6 — Apply Updates API
**File**: `src/app/api/import/apply/route.ts`
- POST: `{ sessionId, approvedRows: string[] }`
- Steps:
  1. Load approved import_rows for this session
  2. For each row:
     a. Load master_product by matched_product_id
     b. Apply diff fields to master_product.data
     c. Update master_product.updated_at
     d. Mark import_row action='applied'
  3. Update session updated_count
  4. Log activity
- Returns: `{ updated: number, errors: number }`

#### 3C.7 — Enrichment Tool Page (Step 3)
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/enrich/page.tsx`

**The old `/project/[id]` page and `projects`/`rows` tables are DELETED.** This new page replaces them entirely.

**The enrichment tool has Existing/New sheet toggle and Functions tab:**

- **Existing sheet**: shows products that were updated via the review step (read-only confirmation view)
- **New sheet**: shows products for AI enrichment (full editing + enrichment)

**Data source (NO old tables):**
- Loads `import_session` by sessionId to get session config (enrichment_columns, enrichment_settings)
- Loads `import_rows` where session_id = current session
  - Existing tab: import_rows where match_type='existing' AND action='approved'
  - New tab: import_rows where match_type='new' AND action='approved'
- Enrichment results are saved to `import_rows.enriched_data` (NOT old `rows` table)

**AI Credits Integration:**
- Before starting enrichment, check workspace credit balance via `use-credits.ts` hook
- If insufficient credits: show warning with remaining balance + "Upgrade Plan" button, block enrichment
- Each AI enrichment call (per row) deducts credits via `api/credits/deduct/route.ts`
- Each AI image search deducts credits
- Credit transaction logged to `credit_transactions` table with operation='ai_enrichment' and entity_id=import_row.id
- Credits consumed **EXCLUSIVELY by AI operations** — non-AI operations (matching, reviewing, exporting) cost zero credits

**Reuse strategy:**
- The existing `data-table.tsx` is modified to add Existing/New sheet toggle in header
- The existing `sidebar.tsx` is modified to add Functions tab
- The existing `api/enrich/route.ts` is **REFACTORED** to read/write `import_rows` instead of old `rows` **+ check/deduct AI credits per row**
- The existing `sheet-store.ts` is **REFACTORED** to load from `import_rows` instead of old `rows`
- `src/lib/supabase.ts` is **REWRITTEN**: all old `createProject`, `getProject`, `getProjects`, `getProjectRows`, `insertRows`, `updateRow`, `updateRowsBatch`, `deleteRows`, `saveProjectState` functions are removed and replaced with import_session/import_rows CRUD
- Add "Add to Master" action that creates master_products from enriched import_rows

#### 3C.8 — Add to Master Logic
After enrichment, for each new product row:
1. Get mapped_data (supplier data with column mapping applied)
2. Get enriched_data (AI-generated fields)
3. Create master_product:
   - sku = mapped_data.sku
   - data = mapped_data (all supplier fields)
   - enriched_data = enriched_data (AI fields)
   - category_id = user-selected category
   - status = 'active'
4. Mark import_row action='applied'
5. Update session enriched_count

Handle SKU conflicts:
- If SKU already exists in master (edge case): prompt user to skip or overwrite

#### 3C.9 — Session Completion
- When all rows are applied/skipped:
  - Update session status='completed'
  - Log activity
  - Show completion summary:
    - X products updated
    - Y new products added
    - Z rows rejected/skipped
    - Duration
    - Total price impact + stock change
  - "Back to Imports" button
