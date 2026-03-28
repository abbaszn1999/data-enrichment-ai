# Part 3: Supabase Storage & RLS Security Policies

Storage bucket setup, folder structure, and all Row Level Security policies for the platform.

> **⚠️ UPDATED** — No major structural changes to storage. RLS policies updated to include 3 new tables: `subscription_plans`, `workspace_subscriptions`, `credit_transactions`. Export templates table is still used (exports triggered from Products/Review pages, not sidebar).

---

## Supabase Storage

### Create Private Bucket

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-files',
  'workspace-files',
  FALSE,
  52428800,  -- 50MB max
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml'
  ]
);
```

### Folder Structure

```
workspace-files/
  {workspace_id}/
    master/
      products_2025-06-01.xlsx       -- Master product uploads
      categories_2025-06-01.csv      -- Category uploads
    supplier/
      samsung_june_2025.xlsx         -- Supplier sheet uploads
      dell_july_2025.csv
    exports/
      shopify_export_2025-06-15.csv  -- Generated exports
    logos/
      logo.png                       -- Workspace logo
```

### Storage RLS Policies

```sql
-- Members can read files from their workspace
CREATE POLICY "workspace_files_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'workspace-files'
    AND (storage.foldername(name))[1] IN (
      SELECT w.id::text FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = auth.uid()
    )
  );

-- Owner/Admin/Editor can upload files
CREATE POLICY "workspace_files_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'workspace-files'
    AND (storage.foldername(name))[1] IN (
      SELECT w.id::text FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin', 'editor')
    )
  );

-- Owner/Admin can delete files
CREATE POLICY "workspace_files_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'workspace-files'
    AND (storage.foldername(name))[1] IN (
      SELECT w.id::text FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
    )
  );
```

---

## RLS Policies for All Tables

### Enable RLS

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
```

### Helper Function

```sql
CREATE OR REPLACE FUNCTION is_workspace_member(
  ws_id UUID,
  min_role TEXT DEFAULT 'viewer'
)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
    AND user_id = auth.uid()
    AND CASE min_role
      WHEN 'owner'  THEN role = 'owner'
      WHEN 'admin'  THEN role IN ('owner', 'admin')
      WHEN 'editor' THEN role IN ('owner', 'admin', 'editor')
      WHEN 'viewer' THEN role IN ('owner', 'admin', 'editor', 'viewer')
    END
  );
$$ LANGUAGE sql SECURITY DEFINER;
```

### profiles

```sql
-- Anyone can view profiles (for displaying names/avatars in teams)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (TRUE);

-- Users can only update their own profile
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Profile is auto-created by trigger, no manual insert needed
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());
```

### workspaces

```sql
-- Members can see their workspaces
CREATE POLICY "workspaces_select" ON workspaces
  FOR SELECT USING (is_workspace_member(id));

-- Any authenticated user can create a workspace
CREATE POLICY "workspaces_insert" ON workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Admin+ can update workspace settings
CREATE POLICY "workspaces_update" ON workspaces
  FOR UPDATE USING (is_workspace_member(id, 'admin'));

-- Only owner can delete workspace
CREATE POLICY "workspaces_delete" ON workspaces
  FOR DELETE USING (owner_id = auth.uid());
```

### workspace_members

```sql
-- Members can see other members in their workspace
CREATE POLICY "members_select" ON workspace_members
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Admin+ can add members
CREATE POLICY "members_insert" ON workspace_members
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

-- Admin+ can update roles (but not their own to prevent lockout)
CREATE POLICY "members_update" ON workspace_members
  FOR UPDATE USING (
    is_workspace_member(workspace_id, 'admin')
    AND user_id != auth.uid()
  );

-- Admin+ can remove members (but not themselves)
CREATE POLICY "members_delete" ON workspace_members
  FOR DELETE USING (
    is_workspace_member(workspace_id, 'admin')
    AND user_id != auth.uid()
  );
```

### workspace_invites

```sql
-- Members can see invites for their workspace
CREATE POLICY "invites_select" ON workspace_invites
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Admin+ can create invites
CREATE POLICY "invites_insert" ON workspace_invites
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

-- Admin+ can cancel/delete invites
CREATE POLICY "invites_delete" ON workspace_invites
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));

-- Anyone can update invite (to accept it via token)
CREATE POLICY "invites_update" ON workspace_invites
  FOR UPDATE USING (TRUE);
```

### categories

```sql
-- Members can view categories
CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Admin+ can create/update/delete categories
CREATE POLICY "categories_insert" ON categories
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "categories_update" ON categories
  FOR UPDATE USING (is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "categories_delete" ON categories
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));
```

### master_products

```sql
-- Members can view products
CREATE POLICY "products_select" ON master_products
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Admin+ can create/update/delete products
CREATE POLICY "products_insert" ON master_products
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "products_update" ON master_products
  FOR UPDATE USING (is_workspace_member(workspace_id, 'admin'));

CREATE POLICY "products_delete" ON master_products
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));
```

### uploaded_files

```sql
-- Members can view file metadata
CREATE POLICY "files_select" ON uploaded_files
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Editor+ can upload files
CREATE POLICY "files_insert" ON uploaded_files
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

-- Admin+ can delete file records
CREATE POLICY "files_delete" ON uploaded_files
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));
```

### supplier_profiles

```sql
-- Members can view supplier profiles
CREATE POLICY "suppliers_select" ON supplier_profiles
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Editor+ can create/update suppliers
CREATE POLICY "suppliers_insert" ON supplier_profiles
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "suppliers_update" ON supplier_profiles
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

-- Admin+ can delete suppliers
CREATE POLICY "suppliers_delete" ON supplier_profiles
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));
```

### import_sessions

```sql
-- Members can view sessions
CREATE POLICY "sessions_select" ON import_sessions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Editor+ can create/update sessions
CREATE POLICY "sessions_insert" ON import_sessions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));

CREATE POLICY "sessions_update" ON import_sessions
  FOR UPDATE USING (is_workspace_member(workspace_id, 'editor'));

-- Admin+ can delete sessions
CREATE POLICY "sessions_delete" ON import_sessions
  FOR DELETE USING (is_workspace_member(workspace_id, 'admin'));
```

### import_rows

```sql
-- Members can view import rows (via session)
CREATE POLICY "import_rows_select" ON import_rows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM import_sessions s
      WHERE s.id = import_rows.session_id
      AND is_workspace_member(s.workspace_id)
    )
  );

-- Editor+ can create/update import rows
CREATE POLICY "import_rows_insert" ON import_rows
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM import_sessions s
      WHERE s.id = import_rows.session_id
      AND is_workspace_member(s.workspace_id, 'editor')
    )
  );

CREATE POLICY "import_rows_update" ON import_rows
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM import_sessions s
      WHERE s.id = import_rows.session_id
      AND is_workspace_member(s.workspace_id, 'editor')
    )
  );

-- Admin+ can delete import rows
CREATE POLICY "import_rows_delete" ON import_rows
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM import_sessions s
      WHERE s.id = import_rows.session_id
      AND is_workspace_member(s.workspace_id, 'admin')
    )
  );
```

### export_templates

```sql
-- System templates visible to all authenticated users
-- Workspace templates visible to workspace members
CREATE POLICY "templates_select" ON export_templates
  FOR SELECT USING (
    is_system = TRUE
    OR (workspace_id IS NOT NULL AND is_workspace_member(workspace_id))
  );

-- Admin+ can create custom templates
CREATE POLICY "templates_insert" ON export_templates
  FOR INSERT WITH CHECK (
    is_system = FALSE
    AND workspace_id IS NOT NULL
    AND is_workspace_member(workspace_id, 'admin')
  );

CREATE POLICY "templates_update" ON export_templates
  FOR UPDATE USING (
    is_system = FALSE
    AND workspace_id IS NOT NULL
    AND is_workspace_member(workspace_id, 'admin')
  );

CREATE POLICY "templates_delete" ON export_templates
  FOR DELETE USING (
    is_system = FALSE
    AND workspace_id IS NOT NULL
    AND is_workspace_member(workspace_id, 'admin')
  );
```

### activity_log

```sql
-- Members can view activity in their workspace
CREATE POLICY "activity_select" ON activity_log
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Any member can create log entries (system creates them)
CREATE POLICY "activity_insert" ON activity_log
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id));
```

### subscription_plans

```sql
-- All authenticated users can view plans (for pricing page, plan selection)
CREATE POLICY "plans_select" ON subscription_plans
  FOR SELECT USING (TRUE);

-- Only system/admin can manage plans (no user-facing insert/update/delete)
-- Plans are managed via Supabase Dashboard or service role key
```

### workspace_subscriptions

```sql
-- Members can view their workspace subscription
CREATE POLICY "subscriptions_select" ON workspace_subscriptions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- Only owner can update subscription (upgrade/downgrade/cancel)
CREATE POLICY "subscriptions_update" ON workspace_subscriptions
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_subscriptions.workspace_id
      AND w.owner_id = auth.uid()
    )
  );

-- Subscription creation handled by system (on workspace creation or plan change)
CREATE POLICY "subscriptions_insert" ON workspace_subscriptions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'owner'));
```

### credit_transactions

```sql
-- Members can view credit transactions for their workspace
CREATE POLICY "credits_select" ON credit_transactions
  FOR SELECT USING (is_workspace_member(workspace_id));

-- System creates credit transactions (via API routes with service role)
-- Editor+ can trigger AI operations which create credit entries
CREATE POLICY "credits_insert" ON credit_transactions
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id, 'editor'));
```
