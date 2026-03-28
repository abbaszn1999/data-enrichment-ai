# Part 2: Database Schema (Full SQL)

All 15 tables, triggers, indexes, and helper functions for the DataSheet AI Platform.

> **⚠️ UPDATED** — Added `cms_type` field to workspaces table. Added `notes` and `tags` fields to import_sessions. Removed `mapping` from import_sessions status (now starts at `matching`). **Old `projects` and `rows` tables will be DELETED** — not migrated. The enrichment tool reads/writes `import_sessions` + `import_rows` directly. **Added 3 new tables**: `subscription_plans`, `workspace_subscriptions`, `credit_transactions` for subscription tiers and AI credits system.

Run all SQL in Supabase SQL Editor in order.

---

## Table 1: profiles

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

---

## Table 2: workspaces

```sql
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  logo_url TEXT,
  cms_type TEXT DEFAULT '',
  -- CMS/Platform type: 'shopify', 'woocommerce', 'salla', 'zid', 'magento', 'custom', etc.
  -- Used to pre-configure export templates and field mappings
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{
    "default_language": "English",
    "default_enrichment_model": "gemini-3.1-pro-preview",
    "default_thinking_level": "low"
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);
```

---

## Table 3: workspace_members

```sql
CREATE TABLE workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  invited_by UUID REFERENCES auth.users(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_members_workspace ON workspace_members(workspace_id);
CREATE INDEX idx_members_user ON workspace_members(user_id);

-- Auto-add owner as member when workspace is created
CREATE OR REPLACE FUNCTION handle_new_workspace()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_workspace_created
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION handle_new_workspace();
```

---

## Table 4: workspace_invites

```sql
CREATE TABLE workspace_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invites_token ON workspace_invites(token);
CREATE INDEX idx_invites_email ON workspace_invites(email);
```

---

## Table 5: categories

```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT DEFAULT '',
  attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- attributes example: [{"name": "RAM", "type": "text"}, {"name": "Screen Size", "type": "text"}]
  sort_order INT NOT NULL DEFAULT 0,
  product_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, slug)
);

CREATE INDEX idx_categories_workspace ON categories(workspace_id);
CREATE INDEX idx_categories_parent ON categories(parent_id);
```

---

## Table 6: master_products

```sql
CREATE TABLE master_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- data stores ALL product fields dynamically:
  -- {"name": "...", "price": "...", "stock": "...", "brand": "...", ...}
  enriched_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- AI-generated data: {"enhancedTitle": "...", "marketingDescription": "...", ...}
  source_file_id UUID,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'draft')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, sku)
);

CREATE INDEX idx_products_workspace ON master_products(workspace_id);
CREATE INDEX idx_products_sku ON master_products(workspace_id, sku);
CREATE INDEX idx_products_category ON master_products(category_id);
CREATE INDEX idx_products_status ON master_products(workspace_id, status);
```

---

## Table 7: uploaded_files

```sql
CREATE TABLE uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN (
    'master_products', 'categories', 'supplier_sheet', 'export'
  )),
  storage_path TEXT NOT NULL,
  -- format: "{workspace_id}/master/products_2025-06-01.xlsx"
  file_size_bytes BIGINT,
  mime_type TEXT,
  original_columns TEXT[] DEFAULT '{}',
  column_mapping JSONB DEFAULT '{}'::jsonb,
  -- {"supplier_col": "system_col", ...}
  row_count INT DEFAULT 0,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_files_workspace ON uploaded_files(workspace_id);
CREATE INDEX idx_files_type ON uploaded_files(workspace_id, file_type);
```

---

## Table 8: supplier_profiles

```sql
CREATE TABLE supplier_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- e.g. "Samsung Electronics", "Dell Wholesale"
  default_column_mapping JSONB DEFAULT '{}'::jsonb,
  -- Saved mapping so user doesn't redo it each time
  default_matching_rules JSONB DEFAULT '[]'::jsonb,
  -- Saved matching rules
  default_match_column TEXT,
  -- Which column to match on (e.g. "sku")
  notes TEXT DEFAULT '',
  import_count INT NOT NULL DEFAULT 0,
  last_import_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_workspace ON supplier_profiles(workspace_id);
```

---

## Table 9: import_sessions

```sql
CREATE TABLE import_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES supplier_profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  -- e.g. "Samsung Shipment - June 2025"
  notes TEXT DEFAULT '',
  -- Optional notes about this import session
  tags TEXT[] DEFAULT '{}',
  -- Tags for organizing/filtering sessions: e.g. {'monthly', 'priority'}

  -- Workflow status (Column Mapping removed — handled in New Import page via AI auto-preview)
  status TEXT NOT NULL DEFAULT 'matching'
    CHECK (status IN (
      'matching',    -- Step 1: configuring matching rules
      'review',      -- Step 2: user reviewing/approving results
      'enriching',   -- Step 3: AI enrichment in enrichment tool
      'completed',   -- Done
      'cancelled'    -- Cancelled by user
    )),

  -- Column Mapping config (auto-detected via AI in New Import page)
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {"Part Number": "sku", "Product Name": "name", "Unit Price": "price"}

  -- Matching config
  supplier_match_column TEXT,
  -- Which column from the supplier file to use for matching (e.g. "Part Number", "Item Code")
  -- Values come from the uploaded file's column headers (stored in column_mapping keys)
  master_match_column TEXT DEFAULT 'sku',
  -- Which system column from master_products to match against (e.g. "sku", "barcode", "name")
  target_category_ids UUID[] DEFAULT '{}',
  -- Optional: limit matching to specific categories (multi-select, empty = all categories)

  -- Matching Rules
  matching_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [
  --   {"type": "trim_whitespace", "enabled": true},
  --   {"type": "case_insensitive", "enabled": true},
  --   {"type": "ignore_prefix", "value": "00", "enabled": true},
  --   {"type": "ignore_suffix", "value": "-NEW", "enabled": false},
  --   {"type": "strip_non_alnum", "enabled": false},
  --   {"type": "regex_extract", "pattern": "\\d+", "enabled": false},
  --   {"type": "contains", "enabled": false}
  -- ]

  -- Enrichment config (for new products)
  enrichment_columns JSONB DEFAULT '[]'::jsonb,
  enrichment_settings JSONB DEFAULT '{}'::jsonb,

  -- Results summary
  total_rows INT NOT NULL DEFAULT 0,
  existing_count INT NOT NULL DEFAULT 0,
  new_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  enriched_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,

  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_workspace ON import_sessions(workspace_id);
CREATE INDEX idx_sessions_status ON import_sessions(workspace_id, status);
```

---

## Table 10: import_rows

```sql
CREATE TABLE import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  row_index INT NOT NULL,

  -- Classification after matching
  match_type TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_type IN ('existing', 'new', 'unmatched')),
  matched_product_id UUID REFERENCES master_products(id) ON DELETE SET NULL,
  match_confidence REAL,
  -- 0.0 to 1.0 confidence score

  -- Raw supplier data (as-is from the file)
  supplier_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Mapped data (after column mapping applied)
  mapped_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- AI-enriched data (for new products)
  enriched_data JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'error', 'skipped')),
  error_message TEXT,

  -- User decision
  action TEXT NOT NULL DEFAULT 'pending'
    CHECK (action IN (
      'pending',   -- Not decided yet
      'update',    -- Update existing product
      'add',       -- Add as new product
      'skip',      -- Ignore this row
      'applied'    -- Already applied to master
    )),

  -- Diff data (for existing products: what changed)
  diff_data JSONB DEFAULT '{}'::jsonb,
  -- {"price": {"old": "100", "new": "95"}, "stock": {"old": "50", "new": "120"}}

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_rows_session ON import_rows(session_id);
CREATE INDEX idx_import_rows_match ON import_rows(match_type);
CREATE INDEX idx_import_rows_status ON import_rows(status);
CREATE INDEX idx_import_rows_action ON import_rows(action);
```

---

## Table 11: export_templates

```sql
CREATE TABLE export_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  -- NULL workspace_id = system template (built-in)
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN (
    'shopify', 'woocommerce', 'magento', 'salla', 'zid',
    'amazon', 'noon', 'generic_csv', 'generic_xlsx', 'custom'
  )),
  description TEXT DEFAULT '',
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {"system_field": "platform_field", ...}
  -- e.g. {"enhancedTitle": "Title", "sku": "Handle", "marketingDescription": "Body (HTML)"}
  file_format TEXT NOT NULL DEFAULT 'csv'
    CHECK (file_format IN ('csv', 'xlsx', 'tsv')),
  include_headers BOOLEAN NOT NULL DEFAULT TRUE,
  delimiter TEXT DEFAULT ',',
  encoding TEXT DEFAULT 'utf-8',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_workspace ON export_templates(workspace_id);
```

---

## Table 12: activity_log

```sql
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  -- Actions: 'user_joined', 'file_uploaded', 'import_started', 'import_completed',
  -- 'enrichment_started', 'enrichment_completed', 'products_updated', 'export_generated',
  -- 'member_invited', 'member_removed', 'role_changed', 'settings_updated'
  entity_type TEXT,
  -- 'workspace', 'product', 'category', 'import_session', 'file', 'member'
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  -- Additional context, e.g. {"file_name": "samsung.xlsx", "row_count": 500}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_workspace ON activity_log(workspace_id);
CREATE INDEX idx_activity_created ON activity_log(workspace_id, created_at DESC);
```

---

## Table 13: subscription_plans

```sql
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  -- 'starter', 'pro', 'enterprise'
  display_name TEXT NOT NULL,
  -- 'Starter', 'Pro', 'Enterprise'
  description TEXT DEFAULT '',
  
  -- Feature limits (TBD — exact values will be set later)
  max_workspaces INT,            -- NULL = unlimited
  max_members_per_workspace INT, -- NULL = unlimited
  max_products_per_workspace INT,-- NULL = unlimited
  max_imports_per_month INT,     -- NULL = unlimited
  max_storage_bytes BIGINT,      -- NULL = unlimited
  
  -- AI Credits
  monthly_ai_credits INT NOT NULL DEFAULT 0,
  -- Credits reset monthly. Credits are consumed ONLY by AI operations:
  -- AI Enrichment (per row), AI Image Search (per query),
  -- AI Column Mapping (per import), AI Category Suggestion (per product)
  
  -- Pricing (stored for reference, actual billing handled externally)
  price_monthly NUMERIC(10,2) DEFAULT 0,
  price_yearly NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## Table 14: workspace_subscriptions

```sql
CREATE TABLE workspace_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id),
  
  -- Billing
  billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly', 'lifetime')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'expired')),
  
  -- Dates
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  -- Credit tracking (resets each billing period)
  credits_used INT NOT NULL DEFAULT 0,
  credits_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- External billing reference (Stripe, etc.)
  external_subscription_id TEXT,
  external_customer_id TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id)
);

CREATE INDEX idx_subscriptions_workspace ON workspace_subscriptions(workspace_id);
CREATE INDEX idx_subscriptions_plan ON workspace_subscriptions(plan_id);
CREATE INDEX idx_subscriptions_status ON workspace_subscriptions(status);
```

---

## Table 15: credit_transactions

```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Transaction details
  operation TEXT NOT NULL CHECK (operation IN (
    'ai_enrichment',       -- AI enriched a product row
    'ai_image_search',     -- AI searched for product images
    'ai_column_mapping',   -- AI auto-detected column mapping
    'ai_category_suggest', -- AI suggested a category (future)
    'credit_topup',        -- Manual credit addition (admin/billing)
    'monthly_reset'        -- Monthly credit reset from plan
  )),
  
  credits_used INT NOT NULL DEFAULT 0,
  -- Positive = credits consumed, Negative = credits added (topup/reset)
  
  -- Context
  entity_type TEXT,
  -- 'import_session', 'import_row', 'master_product'
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  -- e.g. {"session_name": "Samsung Q3", "rows_enriched": 50, "model": "gemini-pro"}
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credits_workspace ON credit_transactions(workspace_id);
CREATE INDEX idx_credits_operation ON credit_transactions(workspace_id, operation);
CREATE INDEX idx_credits_created ON credit_transactions(workspace_id, created_at DESC);
```

> **IMPORTANT**: Credits are consumed **EXCLUSIVELY by AI operations**. Non-AI operations (file upload, SKU matching, exporting, team management, etc.) do NOT consume credits.

---

## Cleanup: Delete old tables

```sql
-- The old projects/rows tables are no longer needed.
-- The enrichment tool now reads/writes from import_sessions + import_rows directly.
-- Run this AFTER the enrichment tool has been refactored:
DROP TABLE IF EXISTS rows CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
```

> **IMPORTANT**: Also delete the following files after refactoring:
> - `src/app/projects/page.tsx` — old project list (replaced by `/w/[slug]/import`)
> - `src/app/project/[id]/page.tsx` — old project view (enrichment tool now at `/w/[slug]/import/[id]/enrich`)
> - Remove all `createProject`, `deleteProject`, `duplicateProject`, `getProject`, `getProjects`, `getProjectRows`, `insertRows`, `updateRow`, `updateRowsBatch`, `deleteRows`, `saveProjectState` functions from `src/lib/supabase.ts`
> - Refactor `src/store/sheet-store.ts` to load from `import_rows` instead of `rows`
> - Refactor `src/app/api/enrich/route.ts` to read/write `import_rows` instead of `rows`

---

## Seed Data: System Export Templates

```sql
INSERT INTO export_templates (name, platform, description, column_mapping, file_format, is_system) VALUES
(
  'Shopify Products',
  'shopify',
  'Standard Shopify product import CSV format',
  '{
    "sku": "Variant SKU",
    "enhancedTitle": "Title",
    "marketingDescription": "Body (HTML)",
    "category": "Type",
    "seoKeywords": "Tags",
    "price": "Variant Price",
    "stock": "Variant Inventory Qty",
    "brand": "Vendor",
    "imageUrls": "Image Src"
  }'::jsonb,
  'csv',
  TRUE
),
(
  'WooCommerce Products',
  'woocommerce',
  'WooCommerce product import CSV format',
  '{
    "sku": "SKU",
    "enhancedTitle": "Name",
    "marketingDescription": "Description",
    "category": "Categories",
    "seoKeywords": "Tags",
    "price": "Regular price",
    "stock": "Stock",
    "imageUrls": "Images"
  }'::jsonb,
  'csv',
  TRUE
),
(
  'Salla Products',
  'salla',
  'Salla (Arabic e-commerce) product import format',
  '{
    "sku": "SKU",
    "enhancedTitle": "product_name",
    "marketingDescription": "description",
    "category": "category",
    "price": "price",
    "stock": "quantity",
    "imageUrls": "images"
  }'::jsonb,
  'csv',
  TRUE
),
(
  'Zid Products',
  'zid',
  'Zid (Arabic e-commerce) product import format',
  '{
    "sku": "sku",
    "enhancedTitle": "name",
    "marketingDescription": "description",
    "category": "category_name",
    "price": "price",
    "stock": "quantity",
    "imageUrls": "image_url"
  }'::jsonb,
  'xlsx',
  TRUE
),
(
  'Amazon Flat File',
  'amazon',
  'Amazon Seller Central flat file format',
  '{
    "sku": "item_sku",
    "enhancedTitle": "item_name",
    "marketingDescription": "product_description",
    "marketplaceBullets": "bullet_point",
    "category": "feed_product_type",
    "seoKeywords": "generic_keywords",
    "price": "standard_price",
    "stock": "quantity",
    "brand": "brand_name",
    "imageUrls": "main_image_url"
  }'::jsonb,
  'tsv',
  TRUE
),
(
  'Noon Products',
  'noon',
  'Noon marketplace product template',
  '{
    "sku": "Partner SKU",
    "enhancedTitle": "Product Title",
    "marketingDescription": "Product Description",
    "marketplaceBullets": "Key Features",
    "category": "Category",
    "brand": "Brand",
    "price": "Sale Price",
    "imageUrls": "Image 1"
  }'::jsonb,
  'xlsx',
  TRUE
);
```
