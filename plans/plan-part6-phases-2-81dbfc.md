# Part 6: Phase 2A (Master Data) & Phase 2B (Supabase Storage)

Detailed implementation tasks for products, categories, and file storage.

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
- Interactive tree view of all categories
- Expand/collapse nodes
- Click to select -> show details panel
- Actions: Add Root, Add Child, Edit, Delete
- Only Admin+ can modify (Editor/Viewer = read-only)

#### Category Tree Component
**File**: `src/components/categories/category-tree.tsx`
- Recursive tree rendering with indentation
- Each node shows: name, product count, expand arrow
- Click node -> select it (highlight)
- Double-click -> edit inline
- Drag-and-drop to reorder or move under different parent
- Right-click context menu: Add child, Edit, Delete

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

#### Category Upload
**File**: `src/app/(dashboard)/w/[workspaceSlug]/categories/upload/page.tsx`
**File**: `src/components/categories/category-upload-wizard.tsx`
- Step 1: Upload CSV/Excel file
- Step 2: Preview first 5 rows
- Step 3: Map columns:
  - Required: Name column
  - Optional: Parent Name, Description
  - System detects hierarchy from Parent Name (e.g., "Electronics > Laptops" or separate parent column)
- Step 4: Review tree preview
- Step 5: Import with progress

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
- Multi-step wizard:

  **Step 1: Upload File**
  - Drag-drop zone for Excel/CSV
  - Show file name + size after upload
  - Save original file to Supabase Storage
  
  **Step 2: Preview**
  - Show first 5 rows in a table
  - Show detected columns
  - Show total row count
  
  **Step 3: Column Mapping**
  - Left: file columns (with sample values)
  - Right: system fields dropdown per column
  - Required mapping: SKU (highlighted in red if not mapped)
  - System fields: SKU, Name, Description, Price, Stock, Brand, Category, Weight, Dimensions, Color, Size, + "Custom Field" option
  - AI auto-suggest: if column name looks like a system field, pre-select it
    - "Part Number" / "Item Code" / "SKU" -> SKU
    - "Product Name" / "Title" / "Item Name" -> Name
    - "Unit Price" / "Cost" / "Price" -> Price
    - etc.
  - Unmapped columns: still imported into data JSONB with original column name
  
  **Step 4: Category Assignment (optional)**
  - Dropdown: assign all products to a category
  - Or: map a column to category names (auto-create categories if needed)
  
  **Step 5: Review & Confirm**
  - Summary: X products to import, Y columns mapped
  - Warning if duplicate SKUs detected in file
  - "Import" button
  
  **Step 6: Processing**
  - Progress bar: "Importing... 450/1000 products"
  - Batch insert (500 at a time) via Supabase
  - On duplicate SKU: option to skip or overwrite
  - Final summary: X imported, Y skipped (duplicates), Z errors

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
