# Part 2: Database Schema (Full SQL)

All 12 tables, triggers, indexes, and helper functions for the DataSheet AI Platform.

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

  -- Workflow status
  status TEXT NOT NULL DEFAULT 'mapping'
    CHECK (status IN (
      'mapping',     -- Step 1: column mapping
      'matching',    -- Step 2: running matching rules
      'review',      -- Step 3: user reviewing existing vs new
      'enriching',   -- Step 4: AI enrichment running
      'completed',   -- Done
      'cancelled'    -- Cancelled by user
    )),

  -- Column Mapping config
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {"Part Number": "sku", "Product Name": "name", "Unit Price": "price"}

  -- Matching config
  match_column TEXT,
  -- Which system column to match on (usually "sku")
  target_category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  -- Optional: limit matching to a specific category

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

## Migration: Link existing projects table to workspaces

```sql
-- After workspace system is live, migrate existing data:
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
-- Then migrate existing projects to the first user's workspace
```

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
