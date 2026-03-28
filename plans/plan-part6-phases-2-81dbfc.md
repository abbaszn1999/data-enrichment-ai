# Part 6: Phase 2A (Master Data) & Phase 2B (Supabase Storage)

Detailed implementation tasks for products, categories, and file storage.

> **⚠️ UPDATED** — Products Upload Wizard enhanced to 4-step wizard with AI column mapping, confidence scores, quality checks, transforms, duplicate detection, and live progress. Categories page enhanced with search, bulk actions, import/export, breadcrumbs, and stats bar.

---

## Phase 2A: Master Data (Products & Categories)

### Goal
User uploads their store's existing products and categories as reference data for future matching.

### Prerequisites
- Phase 1B complete (workspaces exist)
- Run categories + master_products SQL (Part 2, Tables 5-6)
- Run RLS policies for both tables (Part 3)

---

### 2A.1 — Categories

#### Category Tree Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/categories/page.tsx`

Enhanced categories page with:

**Header:**
- Title + description
- Action buttons: "Import from CSV" + "Export" + "Add Category" (primary)
- Search bar to filter categories by name (highlights matches)

**Stats Bar** (4 cards):
- Total Categories
- Root Categories (no parent)
- With Products (categories that have products assigned)
- Max Depth (deepest nesting level in the tree)

**Breadcrumb Navigation:**
- Shows current path when a category is selected
- Clickable breadcrumb segments to navigate up

**Interactive Tree:**
- Recursive tree rendering with indentation and connector lines
- Each node shows: expand arrow + folder icon + name + product count badge
- Expand/collapse with chevron icons
- Click node -> select it (highlight with primary color)
- Selected category shows detail panel below the tree
- Root level has no indentation, children are indented

**Detail Panel** (for selected category):
- Name, Description, Product count, Subcategory count
- Edit / Delete buttons

**Bulk Actions Bar** (when any category is selected):
- Move to... (change parent)
- Delete Selected
- Export Selected

- Only Admin+ can modify (Editor/Viewer = read-only)

#### Category Tree Component
**File**: `src/components/categories/category-tree.tsx`
- Recursive tree rendering with indentation
- Each node shows: name, product count, expand arrow
- Click node -> select it (highlight)
- Search filtering with match highlighting
- Expand/collapse all functionality

#### Category Form
**File**: `src/components/categories/category-form.tsx`
- Dialog for add/edit category
- Fields:
  - Name (required)
  - Parent (dropdown of existing categories, "None" for root)
  - Description (optional textarea)
  - Custom Attributes (dynamic list):
    - Add attribute: name + type (text, number, select)
    - Remove attribute
    - Example: Laptops category has attributes: RAM, CPU, Screen Size
- Auto-generate slug from name

#### Category Stats Component
**File**: `src/components/categories/category-stats.tsx`
- 4 stat cards: Total, Root, With Products, Max Depth
- Compact design with icons and muted text

#### CRUD Functions
**File**: `src/lib/supabase.ts` (EXPAND)
```
getCategories(workspaceId) -> tree structure
getCategoryById(id)
createCategory(workspaceId, { name, parentId, description, attributes })
updateCategory(id, updates)
deleteCategory(id) -> cascade: products in this category get category_id = null
reorderCategories(workspaceId, orderedIds)
getCategoryPath(id) -> "Electronics > Computers > Laptops"
```

---

### 2A.2 — Master Products

#### Products Table Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/products/page.tsx`
- Full-featured data table (reuse TanStack Table patterns from existing data-table.tsx)
- Features:
  - Search: by SKU, name, any field in data JSONB
  - Filter: by category (dropdown), status (active/archived/draft)
  - Sort: by any column
  - Pagination: 25/50/100/250 per page
  - Column visibility toggle
  - Click row -> detail panel slides in from right
- Header actions:
  - "Upload Products" button -> `/products/upload`
  - "Export" button
  - Bulk actions: Archive, Delete, Change Category (with multi-select)
- Role check: only Admin+ sees edit/delete buttons

#### Products Table Component
**File**: `src/components/products/products-table.tsx`
- Similar to existing data-table.tsx but adapted for master_products
- Columns generated dynamically from product data keys
- Fixed columns: SKU (always first), Status badge, Category name, Actions
- Dynamic columns: all keys from data JSONB
- Enriched data columns: from enriched_data JSONB (if any)
- Cell editing: click to edit (Admin+ only)
- Row selection with checkboxes

#### Product Upload Wizard
**File**: `src/app/(dashboard)/w/[workspaceSlug]/products/upload/page.tsx`
**File**: `src/components/products/product-upload-wizard.tsx`

Enhanced 4-step wizard (consolidated from original 6 steps):

  **Step 1: Upload File**
  - Drag-drop zone for Excel/CSV with visual hover state
  - After upload: file info card (name, size, format icon)
  - Sheet selector (if Excel with multiple sheets): shows sheet name, row count, column count per sheet
  - Recent uploads section: last 3 uploaded files with name, date, row count — click to re-use
  - Save original file to Supabase Storage
  
  **Step 2: Preview & Quality Check**
  - Data preview table: first N rows (configurable: 5/10/20/50)
  - Search within preview rows
  - Quality analysis cards:
    - Total Rows, Total Columns, Encoding detection
    - Empty Required Fields count (red badge if > 0)
    - Invalid Data count
    - Duplicate SKUs count
    - Empty Optional Fields count
  - Column type indicators: each column header shows detected type icon (Hash for numbers, Type for text, FileText for long text)
  - Row selection (expand/collapse preview size)
  
  **Step 3: Column Mapping (AI-Assisted)**
  - Each file column displayed as a card with:
    - Column name (bold)
    - Detected type + icon
    - AI confidence score (99% green, 72% amber, etc.)
    - System field dropdown (pre-filled by AI)
    - Transform option dropdown (none, lowercase, uppercase, trim, etc.)
    - Expandable sample values section (first 3 values from file)
  - AI confidence badges: green (90%+), amber (70-89%), red (<70%)
  - Required fields indicator: SKU must be mapped (warning if missing)
  - System fields: SKU (Required), Name (Required), Price (Required), Description, Stock, Brand, Category, Weight, Dimensions, Color, Image URL, Barcode/EAN, Tags, Body HTML (Shopify), Vendor (Shopify), Product Type (Shopify), Skip
  - Unmapped columns: still imported into data JSONB with original column name
  - "Auto-map All" button to apply AI suggestions
  - "Reset Mappings" button
  
  **Step 4: Import (Duplicate Handling + Progress)**
  - Duplicate handling mode selector:
    - Skip Duplicates (default): if SKU exists, don't import
    - Update Existing: if SKU exists, overwrite data
    - Import as New: import even if SKU exists (creates duplicates)
  - Match by field selector: SKU, Barcode, Product Name
  - "Start Import" button
  - During import:
    - Animated progress bar with percentage
    - Live counter: "Importing... X / Y products"
    - Currently importing product name shown
    - Elapsed time counter
    - Estimated time remaining
  - After import:
    - Success summary: imported count, skipped count, errors count
    - "View Products" and "Upload Another" buttons

#### Product Detail Panel
**File**: `src/components/products/product-detail-panel.tsx`
- Slide-in panel from right (like a drawer)
- Shows all product fields:
  - SKU (non-editable)
  - Category (dropdown)
  - All data fields (editable for Admin+)
  - All enriched_data fields (read-only or editable)
  - Status (dropdown: active/archived/draft)
  - Created/Updated timestamps
  - Source file info
- "Save" button to persist changes

#### CRUD Functions
**File**: `src/lib/supabase.ts` (EXPAND)
```
getMasterProducts(workspaceId, { search, categoryId, status, page, pageSize, sortBy, sortDir })
getMasterProductById(id)
getMasterProductBySku(workspaceId, sku)
createMasterProduct(workspaceId, { sku, data, categoryId })
createMasterProductsBatch(workspaceId, products[]) -> batch insert 500 at a time
updateMasterProduct(id, updates)
updateMasterProductsBatch(updates[])
deleteMasterProducts(ids[])
getMasterProductCount(workspaceId, { categoryId?, status? })
getAllSkus(workspaceId) -> string[] (for matching engine)
```

---

## Phase 2B: Supabase Storage Integration

### Goal
Preserve all uploaded original files in Supabase Storage. Allow download of originals.

### Prerequisites
- Run Storage bucket SQL (Part 3)
- Run Storage RLS policies (Part 3)
- Run uploaded_files table SQL (Part 2, Table 7)

### Tasks

#### 2B.1 — Storage Library
**File**: `src/lib/supabase-storage.ts`
```typescript
// Upload a file to workspace storage
async function uploadWorkspaceFile(
  workspaceId: string,
  folder: 'master' | 'supplier' | 'exports' | 'logos',
  file: File | Blob,
  fileName: string
): Promise<{ storagePath: string; publicUrl?: string }>

// Download a file from storage
async function downloadWorkspaceFile(
  storagePath: string
): Promise<Blob>

// Get a temporary signed URL (1 hour expiry)
async function getSignedUrl(
  storagePath: string,
  expiresIn?: number  // seconds, default 3600
): Promise<string>

// Delete a file from storage
async function deleteWorkspaceFile(
  storagePath: string
): Promise<void>

// Upload workspace logo
async function uploadWorkspaceLogo(
  workspaceId: string,
  file: File
): Promise<string>  // returns public URL
```

#### 2B.2 — File Metadata CRUD
**File**: `src/lib/supabase.ts` (EXPAND)
```
createUploadedFile(workspaceId, { fileName, fileType, storagePath, fileSizeBytes, mimeType, originalColumns, rowCount, uploadedBy })
getUploadedFiles(workspaceId, { fileType? })
getUploadedFile(id)
deleteUploadedFile(id) -> also delete from Storage
```

#### 2B.3 — Integration Points
- **Product Upload Wizard (Step 1)**: After file selected, upload to `{ws_id}/master/{filename}_{timestamp}.xlsx`, create uploaded_files record
- **Category Upload**: Same pattern, folder = `master`
- **Supplier Import (Phase 3A)**: Upload to `{ws_id}/supplier/{name}_{timestamp}.xlsx`
- **Export (Phase 4A)**: Save generated file to `{ws_id}/exports/{platform}_{timestamp}.csv`
- **Workspace Logo**: Upload to `{ws_id}/logos/logo.{ext}`, update workspace.logo_url

#### 2B.4 — Download Original Button
- In Products page: "Download Original File" action
- In Import Session: "Download Supplier File" action
- Uses `getSignedUrl()` to generate temporary download link
- Opens in new tab or triggers download

#### 2B.5 — File History View
- In Products page or Settings: list of all uploaded files
- Table: File Name, Type, Size, Uploaded By, Date, Actions (Download, Delete)
- Admin+ can delete old files
