-- Migration: add collection_prefix column to workspaces table
ALTER TABLE workspaces 
ADD COLUMN IF NOT EXISTS collection_prefix TEXT DEFAULT 'AI' NOT NULL;
