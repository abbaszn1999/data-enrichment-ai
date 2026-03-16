# DataSheet AI Platform — Master Plan

Complete plan to transform the current enrichment tool into a multi-tenant product management platform with Auth, Workspaces, Master Data, Supplier Import with SKU matching, AI enrichment, and multi-platform export.

**This plan is split across multiple files for completeness:**

| File | Contents |
|------|----------|
| **This file** | Overview, current state, target architecture, phases summary, dependencies |
| `plan-part2-database-81dbfc.md` | Full SQL schema (12 tables), triggers, indexes |
| `plan-part3-storage-rls-81dbfc.md` | Supabase Storage buckets, folder structure, all RLS policies |
| `plan-part4-file-structure-81dbfc.md` | Complete new file/folder structure with descriptions |
| `plan-part5-phases-1-81dbfc.md` | Phase 1A (Auth), 1B (Workspaces), 1C (Team/Roles) — detailed tasks |
| `plan-part6-phases-2-81dbfc.md` | Phase 2A (Master Data), 2B (Storage) — detailed tasks |
| `plan-part7-phases-3-81dbfc.md` | Phase 3A (Import/Mapping), 3B (Matching), 3C (Review/Enrich) — detailed tasks |
| `plan-part8-phases-4-5-81dbfc.md` | Phase 4A (Export), Phase 5 (Advanced), migration strategy, dependencies |

---

## Current State

### Tech Stack
- **Framework**: Next.js 16.1.6 (App Router) + TypeScript
- **UI**: Tailwind CSS 4 + shadcn/ui + Lucide + Radix UI
- **State**: Zustand (sheet-store.ts)
- **Database**: Supabase (2 tables: projects, rows)
- **AI**: Google Gemini (@google/genai)
- **Excel**: xlsx + exceljs + jszip
- **Table**: TanStack Table v8 + TanStack Virtual

### Existing Supabase Tables
- **projects**: id, name, file_name, original_columns, source_columns, enrichment_columns, enrichment_settings, column_visibility, row_count, enriched_count, created_at, updated_at
- **rows**: id, project_id, row_index, status, error_message, original_data, enriched_data, created_at

### Existing Key Files (to preserve/refactor)
- `src/components/data-table.tsx` — 1817 lines, main data table with pagination
- `src/components/sidebar.tsx` — 1147 lines, enrichment config
- `src/lib/gemini.ts` — 397 lines, AI search + enrich + image search
- `src/lib/prompts.ts` — 185 lines, prompt builders
- `src/lib/excel.ts` — 358 lines, parse + export Excel
- `src/lib/supabase.ts` — 197 lines, Supabase CRUD
- `src/store/sheet-store.ts` — 702 lines, Zustand store
- `src/types/index.ts` — 165 lines, all types
- `src/app/api/enrich/route.ts` — 134 lines, SSE enrichment API
- `src/app/projects/page.tsx` — 485 lines, projects list
- `src/app/project/[id]/page.tsx` — 129 lines, project view

---

## Target Architecture

### User Flow
```
Register/Login
  -> Create Workspace (or accept invite)
  -> Upload Master Data (one-time)
     |- Products (Excel/CSV with SKU)
     |- Categories (Excel/CSV or manual)
  -> Receive Supplier Sheet
  -> Column Mapping (supplier cols -> system cols)
  -> Matching Rules (SKU matching with transformations)
  -> Auto-Split into 2 sheets:
     |- Existing -> Diff View -> Apply Updates
     |- New -> AI Enrichment -> Add to Master
  -> Export to Platform (Shopify/Woo/Salla/Zid/Amazon/Custom)
```

### New Database Tables (12 total)
1. profiles
2. workspaces
3. workspace_members
4. workspace_invites
5. categories
6. master_products
7. uploaded_files
8. supplier_profiles
9. import_sessions
10. import_rows
11. export_templates
12. activity_log

### Roles
| Permission | Owner | Admin | Editor | Viewer |
|---|---|---|---|---|
| Workspace settings | Yes | Yes | No | No |
| Delete workspace | Yes | No | No | No |
| Invite members | Yes | Yes | No | No |
| Edit Master Products | Yes | Yes | No | No |
| Edit Categories | Yes | Yes | No | No |
| Upload supplier sheet | Yes | Yes | Yes | No |
| Run AI enrichment | Yes | Yes | Yes | No |
| Apply updates to master | Yes | Yes | No | No |
| Export data | Yes | Yes | Yes | Yes |
| View (read-only) | Yes | Yes | Yes | Yes |

---

## Phases Summary

| Phase | Description | Priority |
|-------|-------------|----------|
| **1A** | Auth (Login/Register/Reset + middleware + profiles) | High |
| **1B** | Workspaces (CRUD + slug routing + switcher + layout) | High |
| **1C** | Team & Roles (RBAC + invite system + team page) | High |
| **2A** | Master Data (Categories tree + Products upload/table) | High |
| **2B** | Supabase Storage (file upload/download/preserve originals) | High |
| **3A** | Supplier Import (upload + Column Mapping UI + AI suggestions) | High |
| **3B** | Matching Engine (SKU rules + preview + split Existing/New) | High |
| **3C** | Review & Enrich (Diff view + AI enrichment integration) | High |
| **4A** | Export (Platform selector + format mapping + templates) | Medium |
| **5** | Advanced (Dashboard stats + activity log + notifications) | Low |

---

## New Dependencies to Install

```
npm install @supabase/ssr
```

No other new packages needed — everything else is already in package.json.
