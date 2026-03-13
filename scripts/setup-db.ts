// Run with: npx tsx scripts/setup-db.ts
// Creates the required tables in Supabase

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://umrliaboqdrzxwkmdkmk.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcmxpYWJvcWRyenh3a21ka21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTM2MTksImV4cCI6MjA4ODk2OTYxOX0.PFFZIVi9aKQVE4eoTnJkXEd-LAEsZd1ICj-YgIUl3lg";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function setup() {
  console.log("Testing Supabase connection...");
  
  // Test by trying to select from projects (will fail if table doesn't exist)
  const { error } = await supabase.from("projects").select("id").limit(1);
  
  if (error) {
    console.error("❌ Table 'projects' not found. Please run the SQL below in Supabase Dashboard > SQL Editor:\n");
    console.log(`
-- ========================================
-- DataSheet AI - Database Setup
-- ========================================

-- Projects table
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  original_columns JSONB NOT NULL DEFAULT '[]',
  source_columns JSONB NOT NULL DEFAULT '[]',
  enrichment_columns JSONB NOT NULL DEFAULT '[]',
  enrichment_settings JSONB NOT NULL DEFAULT '{}',
  column_visibility JSONB NOT NULL DEFAULT '{}',
  row_count INT NOT NULL DEFAULT 0,
  enriched_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rows table
CREATE TABLE rows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_index INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  original_data JSONB NOT NULL DEFAULT '{}',
  enriched_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_rows_project_id ON rows(project_id);
CREATE INDEX idx_rows_project_id_row_index ON rows(project_id, row_index);
CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);

-- Auto-update updated_at on projects
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Disable RLS for now (no auth)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE rows ENABLE ROW LEVEL SECURITY;

-- Allow all operations (no auth)
CREATE POLICY "Allow all on projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on rows" ON rows FOR ALL USING (true) WITH CHECK (true);
    `);
    return;
  }

  console.log("✅ Supabase connection successful! Tables exist.");
  
  // Test rows table too
  const { error: rowsError } = await supabase.from("rows").select("id").limit(1);
  if (rowsError) {
    console.error("❌ Table 'rows' not found.");
    return;
  }
  
  console.log("✅ Both 'projects' and 'rows' tables are ready.");
}

setup().catch(console.error);
