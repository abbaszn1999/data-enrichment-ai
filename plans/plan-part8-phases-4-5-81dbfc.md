# Part 8: Phase 4A (Usage & Analytics), Phase 5 (Advanced), Migration & Dependencies

Detailed implementation for usage tracking, multi-platform export (via action buttons), advanced features, migration strategy, and full dependency list.

> **⚠️ UPDATED** — Export has been replaced by Usage/Analytics in the sidebar navigation. Export functionality is still available but accessed from Products page and Import Review page via action buttons, not as a dedicated sidebar page. Workspace settings no longer has an API Config section. **Old `projects` and `rows` tables will be DELETED** — no migration. Enrichment tool reads/writes `import_sessions` + `import_rows` directly. Old `/projects` and `/project/[id]` pages deleted.

---

## Phase 4A: Usage & Analytics + Export Actions

### Goal
Track API usage, enrichment statistics, and usage limits. Export is triggered from context (Products page, Review page) not as a standalone page.

### Prerequisites
- Phase 2A complete (master products exist)
- Run export_templates SQL (Part 2, Table 11) + seed data

### Tasks

#### 4A.0 — Usage & Analytics Page
**File**: `src/app/(dashboard)/w/[workspaceSlug]/usage/page.tsx`

This page replaces Export in the sidebar navigation. It provides:

**AI Credits Section (top):**
- **Credits Remaining**: large number + progress bar (credits_used / plan.monthly_ai_credits)
- **Credits Used This Month**: count + breakdown by operation type
- **Plan Name**: current subscription tier badge (Starter / Pro / Enterprise)
- **Resets On**: date of next billing period start
- Warning banner when < 20% credits remaining: "Running low on AI credits. Upgrade or purchase more."
- "Upgrade Plan" button (if not on highest tier)

> **Credits are consumed EXCLUSIVELY by AI operations**: AI Enrichment (per row), AI Image Search (per query), AI Column Mapping (per import), AI Category Suggestion (future). Non-AI operations cost zero credits.

**Stats Cards:**
- Total AI Credits Used (this month / all time)
- Products Enriched (this month / all time)
- Average Credits per Enrichment
- Average Enrichment Time per Product

**Charts (optional, future):**
- Credit usage per day (line chart)
- Enrichment volume per month (bar chart)
- Match rate trend over imports

**Credit Transaction Log:**
- Table from `credit_transactions`: operation, credits used, entity, user, date
- Filter by operation type (enrichment, image search, column mapping)
- Sortable by date, credits used

**Usage Breakdown by Session:**
- By import session: name, date, credits consumed, products enriched
- Sortable by date, credits

**Subscription Plan Details:**
- Current plan name + tier
- Feature limits with progress bars (workspaces, members, products, imports, storage)
- "Manage Subscription" button -> links to billing portal or settings
- Plan comparison table (Starter vs Pro vs Enterprise)

**Export is NOT in the sidebar** — it is accessed via:
- "Export" button in Products page header
- "Export Report" button in Review Results page
- Quick export from Import Session cards

---

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
- **General**: Workspace name, CMS type, description, logo upload
- **Defaults**: Default language, enrichment model, thinking level
- **Danger Zone**: Delete workspace (owner only, with confirmation)

> **NOTE**: API Keys / API Config section has been removed from workspace settings. API configuration is managed globally, not per-workspace.

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

### Old Tables: DELETE (No Migration)

The existing app has `projects` and `rows` tables. **These will be DELETED entirely — no data migration.**

The enrichment tool (`data-table.tsx` + `sidebar.tsx`) will be refactored to read/write from `import_sessions` + `import_rows` directly.

**Cleanup steps (after refactoring):**
1. Drop old tables: `DROP TABLE IF EXISTS rows CASCADE; DROP TABLE IF EXISTS projects CASCADE;`
2. Delete old pages: `src/app/projects/page.tsx`, `src/app/project/[id]/page.tsx`
3. Rewrite `src/lib/supabase.ts`: remove all old CRUD (`createProject`, `getProject`, `getProjects`, `deleteProject`, `duplicateProject`, `getProjectRows`, `insertRows`, `updateRow`, `updateRowsBatch`, `deleteRows`, `saveProjectState`), replace with workspace/import CRUD
4. Refactor `src/store/sheet-store.ts`: load from `import_rows` instead of `rows`
5. Refactor `src/app/api/enrich/route.ts`: read/write `import_rows` instead of `rows`

### Route Plan (Clean — No Old Routes)
```
/ -> /login (if not auth) or /workspaces (if auth)
/workspaces -> workspace list
/w/[slug] -> workspace dashboard
/w/[slug]/products -> master products (+ upload wizard)
/w/[slug]/categories -> category tree
/w/[slug]/import -> import sessions list
/w/[slug]/import/new -> new import (with AI column preview)
/w/[slug]/import/[id]/rules -> matching rules (step 1)
/w/[slug]/import/[id]/review -> review results (step 2)
/w/[slug]/import/[id]/enrich -> enrichment tool (step 3, reads import_rows)
/w/[slug]/usage -> usage & analytics
/w/[slug]/team -> team management
/w/[slug]/settings -> workspace settings (with CMS type)
```

> **DELETED**: `/projects` and `/project/[id]` — no longer exist, no redirects needed.
> **NO**: `/w/[slug]/import/[id]/mapping` — column mapping handled in New Import page via AI auto-detection.
> **NO**: `/w/[slug]/export` — export accessed via action buttons in Products and Review pages.

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
Phase 1B: Workspaces (+ CMS type + auto-assign Starter plan)
  ↓
Phase 1C: Team & Roles
  ↓
Phase 2A: Master Data (Products 4-step wizard + Categories tree)
  ↓ (can parallelize with 2B)
Phase 2B: Supabase Storage
  ↓
Phase 3A: Supplier Import (upload + AI column preview + quality checks + credit deduction)
  ↓
Phase 3B: Matching Engine (rules + presets + test SKU + live preview) [no credits]
  ↓
Phase 3C: Review & Enrich (approve/reject + diff viz + enrichment tool + credit deduction)
  ↓
Phase 4A: Usage & Analytics + Export Actions + Subscription Management + Credit Dashboard
  ↓
Phase 5: Advanced (Dashboard, Activity, Settings)
```

Each phase builds on the previous. No phase can be skipped.
Estimated total: ~69 new files, ~10 modified/refactored files, 2 deleted files, 15 new database tables (12 core + 3 subscription/credits), 2 old tables deleted.

### Key Changes from Original Plan
1. **Column Mapping removed** as separate import step → now AI auto-preview in New Import page
2. **Import flow simplified** to 3 steps: Rules → Review → Enrichment Tool
3. **Export replaced by Usage** in sidebar navigation
4. **CMS Type** added to workspace creation and settings
5. **Workspace Settings** no longer has API Config section
6. **Enrichment tool** enhanced with Existing/New sheet toggle + Functions tab
7. **Review page** now has approve/reject per row, diff visualization, impact summary, bulk actions
8. **Matching Rules** now has presets, drag reorder, test-a-SKU, AI suggestions
9. **Import Sessions list** enhanced with stats bar, search, sort, tags, actions menu
10. **Products Upload wizard** enhanced with AI confidence, quality checks, transforms
11. **Old `projects` and `rows` tables DELETED** — no migration, enrichment tool reads `import_rows` directly
12. **Old `/projects` and `/project/[id]` pages DELETED** — enrichment tool at `/w/[slug]/import/[id]/enrich`
13. **`supabase.ts` REWRITTEN** — all old CRUD removed, replaced with workspace/import CRUD
14. **`sheet-store.ts` REFACTORED** — loads from `import_rows` instead of old `rows`
15. **`api/enrich/route.ts` REFACTORED** — reads/writes `import_rows` instead of old `rows`
16. **3 Subscription tiers** added (Starter / Pro / Enterprise) — limits TBD
17. **AI Credits system** added — credits consumed EXCLUSIVELY by AI operations (enrichment, image search, column mapping)
18. **3 new database tables** — `subscription_plans`, `workspace_subscriptions`, `credit_transactions`
19. **Usage page enhanced** — now shows AI credits remaining, transaction log, plan details, upgrade prompts
