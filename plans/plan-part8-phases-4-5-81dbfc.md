# Part 8: Phase 4A (Export), Phase 5 (Advanced), Migration & Dependencies

Detailed implementation for multi-platform export, advanced features, migration strategy, and full dependency list.

---

## Phase 4A: Multi-Platform Export

### Goal
Export products in the exact format required by each e-commerce platform. Users select platform, map fields, preview, and download.

### Prerequisites
- Phase 2A complete (master products exist)
- Run export_templates SQL (Part 2, Table 11) + seed data

### Tasks

#### 4A.1 — Export Format Definitions
**File**: `src/lib/export-formats.ts`

Define the column schema for each platform:

```typescript
interface PlatformFormat {
  id: string;                    // 'shopify', 'woocommerce', etc.
  name: string;                  // Display name
  description: string;
  logo: string;                  // Icon/logo path or emoji
  fileFormat: 'csv' | 'xlsx' | 'tsv';
  delimiter?: string;
  encoding?: string;
  columns: PlatformColumn[];     // Required + optional columns
}

interface PlatformColumn {
  platformField: string;         // Column name in platform file
  description: string;           // What this field is for
  required: boolean;
  defaultSystemField?: string;   // Auto-map from system field
  defaultValue?: string;         // Fallback value if no mapping
  transform?: string;            // 'html_wrap', 'join_comma', 'first_image', etc.
}
```

**Supported Platforms:**

1. **Shopify** (CSV)
   - Handle, Title, Body (HTML), Vendor, Type, Tags, Published, Option1 Name/Value, Variant SKU, Variant Price, Variant Inventory Qty, Image Src, Image Position, SEO Title, SEO Description

2. **WooCommerce** (CSV)
   - ID, Type, SKU, Name, Published, Featured, Short description, Description, Regular price, Stock, Categories, Tags, Images, Attribute names/values

3. **Salla** (CSV - Arabic platform)
   - SKU, product_name, description, price, quantity, category, images, options, brand

4. **Zid** (XLSX - Arabic platform)
   - sku, name, description, price, quantity, category_name, image_url, brand, weight

5. **Amazon Seller Central** (TSV - tab-separated)
   - item_sku, item_name, product_description, brand_name, standard_price, quantity, feed_product_type, bullet_point1-5, generic_keywords, main_image_url, other_image_url1-8

6. **Noon** (XLSX)
   - Partner SKU, Product Title, Product Description, Brand, Category, Sale Price, Key Features, Image 1-8

7. **Generic CSV** (CSV)
   - User picks which columns to include + order

8. **Generic XLSX** (XLSX)
   - Same as generic CSV but Excel format

#### 4A.2 — Export Generator
**File**: `src/lib/export-generators.ts`

```typescript
// Generate export file for a specific platform
async function generateExport(
  products: MasterProduct[],
  template: ExportTemplate,
  options?: {
    includeEnriched?: boolean;  // Include AI-enriched fields
    filterByCategory?: string;
    filterByStatus?: string;
  }
): Promise<Blob>

// Transform field value for platform (e.g., wrap description in HTML for Shopify)
function transformValue(
  value: any,
  transform: string
): string

// Available transforms:
// 'html_wrap'      — Wrap text in <p> tags
// 'join_comma'     — Join array with commas
// 'join_newline'   — Join array with newlines
// 'join_pipe'      — Join array with pipes (WooCommerce categories)
// 'first_item'     — Take first item from array
// 'first_image'    — Extract first image URL from imageUrls array
// 'all_images'     — Join all image URLs with comma
// 'bullets_html'   — Convert array to HTML bullet list
// 'strip_html'     — Remove HTML tags
// 'truncate_N'     — Truncate to N characters
```

#### 4A.3 — Export API
**File**: `src/app/api/export/generate/route.ts`
- POST: `{ workspaceId, templateId, productIds?, filters?, options }`
- Server-side generation (for large exports)
- Steps:
  1. Load template (column mapping + format)
  2. Load products (all or filtered)
  3. Apply column mapping + transforms
  4. Generate CSV/XLSX/TSV
  5. Save to Storage `{ws_id}/exports/{platform}_{date}.{ext}`
  6. Create uploaded_files record (type='export')
  7. Log activity
  8. Return signed download URL

#### 4A.4 — Export Wizard Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/export/page.tsx`

Multi-step wizard:

**Step 1: Select Data Source**
- "All Master Products" or "Filtered Products"
- Filters: Category, Status, Date range
- Or: "Import Session Results" (export from a specific import)
- Show count: "X products selected"

**Step 2: Select Platform**
**File**: `src/components/export/platform-selector.tsx`
- Grid of platform cards:
  - Platform logo/icon
  - Platform name
  - File format badge (CSV/XLSX/TSV)
  - Brief description
- Click to select
- "Custom Template" option to create new

**Step 3: Review/Edit Mapping**
**File**: `src/components/export/export-mapping-editor.tsx`
- Table showing:
  - Platform Field (left) | System Field (right, dropdown) | Preview Value
- Pre-filled from template
- User can override any mapping
- "Save as Custom Template" option
- Show which fields have no mapping (will be empty in export)

**Step 4: Preview & Download**
**File**: `src/components/export/export-preview.tsx`
- Preview table: first 5 rows in platform format
- Download options:
  - "Download File" button
  - "Save to Storage" toggle (auto-save to workspace files)
- File info: name, format, size estimate, row count
- "Export" button -> generate + download

#### 4A.5 — Quick Export Button
**File**: `src/components/export-button.tsx` (MODIFY)
- Enhance existing export button with platform selection
- Quick export: dropdown with last-used platform template
- Full export: opens export wizard

---

## Phase 5: Advanced Features

### Goal
Dashboard, activity log, and quality-of-life features.

### Tasks

#### 5.1 — Dashboard Stats
**File**: `src/app/(dashboard)/w/[workspaceSlug]/page.tsx`
- Stats cards (already planned in Phase 1B, detail here):
  - **Total Products**: count from master_products
  - **Categories**: count from categories
  - **Recent Imports**: count from import_sessions (last 30 days)
  - **Team Members**: count from workspace_members
  - **Enrichment Rate**: % of products with enriched_data
  - **Last Import**: date + name of most recent import session
- Quick action buttons:
  - "Upload Products"
  - "New Import"
  - "Export"
- Recent activity feed (last 10 entries from activity_log)
- Charts (optional, future):
  - Products added over time
  - Imports per month

#### 5.2 — Activity Log
**File**: Activity logging integrated into all operations

Every significant action logs to activity_log table:
```
Action Types:
- user_joined          — New member joined workspace
- file_uploaded        — Any file uploaded
- products_imported    — Master products imported from file
- import_started       — New supplier import session created
- import_completed     — Import session finished
- matching_completed   — Matching step done (X existing, Y new)
- enrichment_started   — AI enrichment started (X rows)
- enrichment_completed — AI enrichment done
- products_updated     — Existing products updated from import
- products_added       — New products added to master
- export_generated     — Export file created
- member_invited       — Team member invited
- member_removed       — Team member removed
- role_changed         — Member role changed
- settings_updated     — Workspace settings changed
- category_created     — New category added
- category_deleted     — Category removed
```

Display in:
- Workspace dashboard (last 10)
- Full activity page (searchable, filterable by action type + user + date)
- Each entity detail page (show activity for that entity)

#### 5.3 — Workspace Settings Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/settings/page.tsx`
- **General**: Workspace name, description, logo upload
- **Defaults**: Default language, enrichment model, thinking level
- **API Keys**: Gemini API key per workspace (override global)
- **Danger Zone**: Delete workspace (owner only, with confirmation)

#### 5.4 — User Profile Page
**File**: `src/app/(dashboard)/profile/page.tsx`
- Edit full name
- Upload avatar
- Change password
- View workspace memberships
- Session management (sign out all devices)

#### 5.5 — Notifications (Future)
- In-app notifications:
  - Enrichment completed
  - Import completed
  - Team invite received
  - Products updated
- Notification bell icon in header
- Mark as read/unread
- Email notifications (optional, via Supabase Edge Functions)

#### 5.6 — Auto-Categorization (Future)
- When importing new products, use AI to suggest category
- Based on product name + description + existing category tree
- Show suggestion with confidence score
- User confirms or overrides

#### 5.7 — Price Comparison (Future)
- When same SKU appears from multiple suppliers:
  - Show price comparison across imports
  - Highlight lowest price
  - Track price history over time

---

## Migration Strategy

### Migrating Existing Data

The existing app has `projects` and `rows` tables with data. Strategy:

1. **Don't break existing functionality during development**
   - Keep existing routes working (`/projects`, `/project/[id]`)
   - New workspace routes are additive (`/w/[slug]/...`)
   
2. **After Phase 1A (Auth) is ready:**
   - First registered user becomes the default owner
   - Create a "Default Workspace" for them automatically
   
3. **After Phase 1B (Workspaces) is ready:**
   - Add `workspace_id` column to existing `projects` table
   - Link existing projects to the default workspace
   - Existing project workflow continues to work inside workspace context

4. **After Phase 2A (Master Data) is ready:**
   - Optionally import existing project data as master products
   - This is manual: user chooses which project to convert

5. **After Phase 3 (Import) is ready:**
   - Old project workflow (upload -> enrich) is still available as a "Quick Enrichment" mode
   - New workflow (upload -> match -> review -> enrich) is the full mode

### Route Transition Plan
```
Current:
  / -> /projects
  /projects -> project list
  /project/[id] -> project view

After migration:
  / -> /login (if not auth) or /workspaces (if auth)
  /workspaces -> workspace list
  /w/[slug] -> workspace dashboard
  /w/[slug]/products -> master products
  /w/[slug]/import -> import sessions
  /w/[slug]/import/[id]/enrich -> enrichment (reuses existing components)
  
  /projects -> DEPRECATED (redirect to /workspaces)
  /project/[id] -> DEPRECATED (redirect to workspace context)
```

---

## Dependencies

### Current (already in package.json)
```json
{
  "@google/genai": "^1.42.0",
  "@supabase/supabase-js": "^2.99.1",
  "@tanstack/react-query": "^5.90.21",
  "@tanstack/react-table": "^8.21.3",
  "@tanstack/react-virtual": "^3.13.21",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "exceljs": "^4.4.0",
  "jszip": "^3.10.1",
  "lucide-react": "^0.575.0",
  "next": "16.1.6",
  "next-themes": "^0.4.6",
  "radix-ui": "^1.4.3",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "sonner": "^2.0.7",
  "tailwind-merge": "^3.5.0",
  "xlsx": "^0.18.5",
  "zustand": "^5.0.11"
}
```

### New Dependencies to Add
```
npm install @supabase/ssr
```

That's it — only 1 new package needed. Everything else is covered by existing dependencies:
- Auth UI: built with existing shadcn/ui components
- Tree view: built custom with existing Radix + Tailwind
- Drag-drop: native HTML5 drag-and-drop API
- CSV generation: built-in (string manipulation) or existing xlsx package
- File upload: existing components + Supabase Storage JS client (included in @supabase/supabase-js)

### Environment Variables
```env
# Existing
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...

# New (no new env vars needed!)
# Supabase Auth and Storage use the same URL and anon key
# Server-side operations use the service role key (already available in Supabase)
```

### Optional: Service Role Key (for server-side operations)
```env
SUPABASE_SERVICE_ROLE_KEY=...
```
- Used in API routes for admin-level operations (bypasses RLS)
- Only needed if some operations fail with anon key + RLS
- Never exposed to client

---

## Implementation Order Summary

```
Phase 1A: Auth                    ← START HERE
  ↓
Phase 1B: Workspaces
  ↓
Phase 1C: Team & Roles
  ↓
Phase 2A: Master Data (Products + Categories)
  ↓ (can parallelize with 2B)
Phase 2B: Supabase Storage
  ↓
Phase 3A: Supplier Import + Column Mapping
  ↓
Phase 3B: Matching Engine
  ↓
Phase 3C: Review + AI Enrichment
  ↓
Phase 4A: Multi-Platform Export
  ↓
Phase 5: Advanced (Dashboard, Activity, Settings)
```

Each phase builds on the previous. No phase can be skipped.
Estimated total: ~65 new files, ~7 modified files, 12 new database tables.
