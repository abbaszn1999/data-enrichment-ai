# Part 7: Phase 3A (Supplier Import), 3B (Matching Engine), 3C (Review & Enrich)

Detailed implementation tasks for the core supplier import workflow.

---

## Phase 3A: Supplier Import & Column Mapping

### Goal
Upload supplier sheet, map its columns to system fields, save mapping for reuse.

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
getImportSessions(workspaceId, { status? })
getImportSession(id)
createImportSession(workspaceId, { fileId, supplierId?, name, totalRows })
updateImportSession(id, updates)
deleteImportSession(id)
```

#### 3A.3 — Import Sessions List Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/page.tsx`
- Grid/list of import sessions
- Each card shows:
  - Session name
  - Supplier name (if linked)
  - Status badge (mapping/matching/review/enriching/completed)
  - Row counts: total, existing, new, enriched
  - Created date, created by
  - Click -> navigate to session
- "New Import" button -> `/import/new`
- Filter by status
- Sort by date

#### 3A.4 — New Import Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/new/page.tsx`
**File**: `src/components/import/file-upload-step.tsx`
- Form fields:
  - Session Name (required, e.g. "Samsung Shipment - June 2025")
  - Supplier (dropdown of existing suppliers + "New Supplier" option)
  - Upload File (drag-drop, Excel/CSV)
- On submit:
  1. Upload file to Storage `{ws_id}/supplier/{name}_{date}.xlsx`
  2. Create uploaded_files record
  3. Parse file to get columns + row count
  4. Create import_session with status='mapping'
  5. If existing supplier selected: pre-load saved column mapping
  6. Navigate to `/import/{sessionId}/mapping`

#### 3A.5 — Import Stepper Component
**File**: `src/components/import/import-stepper.tsx`
- Horizontal step indicator showing workflow progress
- Steps: 1.Mapping -> 2.Rules -> 3.Review -> 4.Enrich
- Current step highlighted
- Completed steps have checkmark
- Click completed step to go back

#### 3A.6 — Column Mapping Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/mapping/page.tsx`
**File**: `src/components/import/column-mapping.tsx`

**Layout:**
- Stepper at top (step 1 active)
- Two-column layout:
  - Left: Supplier columns (from file)
  - Right: System field selector per column

**Supplier Column Card (left side):**
- Column name (bold)
- Sample values (first 3 rows, small text)
- Dropdown or drag target for system field

**System Fields (right side dropdown):**
- SKU (required, highlighted)
- Name
- Description
- Price
- Stock / Quantity
- Brand
- Category
- Weight
- Dimensions
- Color / Variant
- Image URL
- Barcode / EAN / UPC
- Custom Field (user types name)
- "-- Skip (don't import) --"

**AI Auto-Suggest:**
- On page load, call Gemini to analyze column names + sample data
- Suggest mappings:
  - "Part Number" -> SKU (confidence: 95%)
  - "Item Description" -> Name (confidence: 85%)
  - "Unit Cost" -> Price (confidence: 90%)
- User can accept or override suggestions
- Show confidence badge next to auto-suggested mappings

**Smart Detection Rules (fallback if AI not needed):**
```
Column name contains "sku" or "part" or "item code" or "model" -> SKU
Column name contains "name" or "title" or "description" -> Name
Column name contains "price" or "cost" or "msrp" -> Price
Column name contains "stock" or "qty" or "quantity" or "inventory" -> Stock
Column name contains "brand" or "manufacturer" or "vendor" -> Brand
Column name contains "category" or "type" or "class" -> Category
```

**Save & Continue:**
- Validate: SKU must be mapped
- Save column_mapping to import_session
- If supplier profile exists: update default_column_mapping
- If new supplier: create supplier_profile with this mapping
- Navigate to `/import/{sessionId}/rules`

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
  1. Load import_session (get column_mapping, matching_rules, target_category_id)
  2. Load uploaded file data (from parsed upload or re-parse from Storage)
  3. Load all master product SKUs for this workspace (optionally filtered by category)
  4. Run matching algorithm
  5. Create import_rows records with match_type set
  6. For "existing" rows: generate diff_data
  7. Update import_session counts (existing_count, new_count)
  8. Update session status to 'review'
- Returns: `{ existing: number, new: number, ambiguous: number }`

#### 3B.3 — Matching Rules Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/rules/page.tsx`
**File**: `src/components/import/matching-rules-editor.tsx`

**Layout:**
- Stepper at top (step 2 active)
- Match column selector (usually SKU, but could be another mapped column)
- Optional: target category filter (only match against products in category X)
- Rules list (toggleable):

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

**Preview Button:**
- "Preview Match Results" button
- Calls matching API in preview mode
- Shows summary: X matched, Y new, Z ambiguous
- Shows sample table (first 10 of each category)

**File**: `src/components/import/match-preview.tsx`
- Summary cards: Existing (green), New (blue), Ambiguous (yellow)
- Preview table:
  - Supplier SKU | Normalized SKU | Match Type | Matched Master SKU | Confidence
- For ambiguous: show "Resolve" button to manually pick correct match

**Confirm Button:**
- "Confirm & Continue" button
- Save matching_rules to import_session
- Update supplier_profile default_matching_rules
- Run full matching (create import_rows)
- Navigate to `/import/{sessionId}/review`

---

## Phase 3C: Review & AI Enrichment

### Goal
Review matching results. Update existing products with supplier data. Enrich new products with AI.

### Prerequisites
- Phase 3B complete (matching done, import_rows created)

### Tasks

#### 3C.1 — Review Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/review/page.tsx`
- Stepper at top (step 3 active)
- Two tabs: "Existing Products" | "New Products"
- Summary bar: X existing (ready to update), Y new (need enrichment)

#### 3C.2 — Existing Products Sheet (Diff View)
**File**: `src/components/import/existing-products-sheet.tsx`
**File**: `src/components/import/diff-cell.tsx`

**Table columns:**
- Checkbox (select row)
- SKU
- Status (pending/update/skip/applied)
- Dynamic columns: each field that differs between supplier and master
  - Cell shows diff: old value (red strikethrough) -> new value (green)
  - Only fields with differences are shown as columns

**Diff Cell component:**
```
┌─────────────────────────┐
│ $100.00  →  $95.00      │
│ (old)       (new)       │
└─────────────────────────┘
```
- Old value: gray/red with strikethrough
- New value: green/bold
- If values are same: just show value (no diff styling)

**Actions per row:**
- "Update" button -> mark action='update'
- "Skip" button -> mark action='skip'

**Bulk actions:**
- "Update All" -> mark all as update
- "Skip All" -> mark all as skip
- "Update Selected" -> mark checked rows as update

**Column filter:**
- "Fields to update" checkboxes
- e.g., only update Price and Stock, not Name
- This determines which fields from diff_data get applied

**Apply Updates button:**
- "Apply X Updates to Master" button
- Calls `/api/import/apply` endpoint
- Server-side: for each row with action='update':
  - Get master_product by matched_product_id
  - Apply selected diff fields to master_product.data
  - Mark import_row action='applied'
- Progress indicator during application
- After done: update session updated_count, show success

#### 3C.3 — Apply Updates API
**File**: `src/app/api/import/apply/route.ts`
- POST: `{ sessionId, fieldsToUpdate: string[] }`
- Steps:
  1. Load all import_rows where action='update' for this session
  2. For each row:
     a. Load master_product by matched_product_id
     b. For each field in fieldsToUpdate:
        - Get new value from mapped_data or diff_data.new
        - Update master_product.data[field]
     c. Update master_product.updated_at
     d. Mark import_row action='applied'
  3. Update session updated_count
  4. Log activity
- Returns: `{ updated: number, errors: number }`

#### 3C.4 — New Products Sheet (Enrichment)
**File**: `src/components/import/new-products-sheet.tsx`

**This reuses the existing enrichment system with adaptation:**

- Table showing new products (match_type='new')
- Columns: from mapped_data (after column mapping applied)
- Status: pending/processing/done/error
- Select rows for enrichment

**Integration with existing enrichment:**
- "Configure Enrichment" -> opens existing sidebar.tsx
  - Source columns = mapped columns from supplier data
  - Enrichment columns = same as existing (Enhanced Title, Marketing Description, etc.)
  - Settings = same as existing (language, model, thinking level)
- "Start Enrichment" button -> calls existing `/api/enrich` endpoint
  - Pass mapped_data as originalData
  - Receive enriched results via SSE
  - Store in import_rows.enriched_data
- After enrichment complete:
  - "Add to Master" button for each row or bulk
  - Creates master_product from mapped_data + enriched_data
  - Assigns to selected category
  - Marks import_row action='applied'

**Reuse strategy:**
- The existing `data-table.tsx` component can be reused for displaying new products
- The existing `sidebar.tsx` component can be reused for enrichment configuration
- The existing `api/enrich/route.ts` is used as-is
- We just need to adapt the data flow:
  - Instead of loading from `projects` table, load from `import_rows` where match_type='new'
  - Instead of saving to `rows` table, save to `import_rows.enriched_data`
  - Add "Add to Master" action that creates master_products

#### 3C.5 — Add to Master Logic
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

#### 3C.6 — Session Completion
- When all rows are applied/skipped:
  - Update session status='completed'
  - Log activity
  - Show completion summary:
    - X products updated
    - Y new products added
    - Z rows skipped
    - Duration
  - "Back to Imports" button

#### 3C.7 — Enrich Page (Step 4)
**File**: `src/app/(dashboard)/w/[workspaceSlug]/import/[sessionId]/enrich/page.tsx`
- Full-screen enrichment view for new products
- Reuses data-table.tsx + sidebar.tsx pattern
- Stepper at top (step 4 active)
- Data source: import_rows where match_type='new' and session_id=current
- After enrichment: "Add All to Master" bulk action
