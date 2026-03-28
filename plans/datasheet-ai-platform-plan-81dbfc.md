# DataSheet AI Platform — Master Plan

Complete plan to transform the current enrichment tool into a multi-tenant product management platform with Auth, Workspaces, Master Data, Supplier Import with SKU matching, AI enrichment, and multi-platform export.

> **⚠️ UPDATED** — This plan reflects all changes made during the demo prototype phase. Column Mapping has been removed as a separate step in the import flow. The sidebar now has "Usage" instead of "Export". CMS Type field has been added to workspaces. The enrichment tool now has Existing/New sheet toggle and a Functions tab. **Old `projects` and `rows` tables will be DELETED** — the enrichment tool will read/write directly from `import_sessions` and `import_rows`. No more `createProject` flow. **Added**: 3 subscription tiers (Starter/Pro/Enterprise) + AI Credits system (credits consumed EXCLUSIVELY by AI operations).

**This plan is split across multiple files for completeness:**

| File | Contents |
|------|----------|
| **This file** | Overview, current state, target architecture, phases summary, dependencies |
| `plan-part2-database-81dbfc.md` | Full SQL schema (15 tables), triggers, indexes |
| `plan-part3-storage-rls-81dbfc.md` | Supabase Storage buckets, folder structure, all RLS policies |
| `plan-part4-file-structure-81dbfc.md` | Complete new file/folder structure with descriptions |
| `plan-part5-phases-1-81dbfc.md` | Phase 1A (Auth), 1B (Workspaces), 1C (Team/Roles) — detailed tasks |
| `plan-part6-phases-2-81dbfc.md` | Phase 2A (Master Data), 2B (Storage) — detailed tasks |
| `plan-part7-phases-3-81dbfc.md` | Phase 3A (Import), 3B (Matching), 3C (Review/Enrich) — detailed tasks |
| `plan-part8-phases-4-5-81dbfc.md` | Phase 4A (Usage/Analytics), Phase 5 (Advanced), migration strategy, dependencies |

---

## Current State

### Tech Stack
- **Framework**: Next.js 16.1.6 (App Router) + TypeScript
- **UI**: Tailwind CSS 4 + shadcn/ui + Lucide + Radix UI
- **State**: Zustand (sheet-store.ts)
- **Database**: Supabase (2 old tables: `projects`, `rows` — **TO BE DELETED**, replaced by new schema)
- **AI**: Google Gemini (@google/genai)
- **Excel**: xlsx + exceljs + jszip
- **Table**: TanStack Table v8 + TanStack Virtual

### Existing Supabase Tables (TO BE DELETED)
- **projects**: ~~id, name, file_name, original_columns, source_columns, enrichment_columns, enrichment_settings, column_visibility, row_count, enriched_count, created_at, updated_at~~ → **REPLACED by `import_sessions`**
- **rows**: ~~id, project_id, row_index, status, error_message, original_data, enriched_data, created_at~~ → **REPLACED by `import_rows`**

> These tables and all related code (`createProject`, `/projects` page, `/project/[id]` page) will be removed. The enrichment tool (`data-table.tsx` + `sidebar.tsx`) will be refactored to read from `import_sessions` + `import_rows` directly.

### Existing Key Files (to preserve/refactor)
- `src/components/data-table.tsx` — 1817 lines, main data table with pagination + Existing/New sheet toggle
- `src/components/sidebar.tsx` — 1147 lines, enrichment config + Functions tab
- `src/lib/gemini.ts` — 397 lines, AI search + enrich + image search
- `src/lib/prompts.ts` — 185 lines, prompt builders
- `src/lib/excel.ts` — 358 lines, parse + export Excel
- `src/lib/supabase.ts` — 197 lines, Supabase CRUD → **REFACTOR**: remove projects/rows CRUD, add import_sessions/import_rows CRUD
- `src/store/sheet-store.ts` — 702 lines, Zustand store → **REFACTOR**: load from import_rows instead of rows table
- `src/types/index.ts` — 165 lines, all types
- `src/app/api/enrich/route.ts` — 134 lines, SSE enrichment API → **REFACTOR**: read/write import_rows instead of rows
- ~~`src/app/projects/page.tsx`~~ — **DELETE**: no longer needed, replaced by `/w/[slug]/import`
- ~~`src/app/project/[id]/page.tsx`~~ — **DELETE**: enrichment tool accessed from Review page via `/w/[slug]/import/[id]/enrich`

### Demo Prototype (to be deleted after client review)
Full working UI prototype under `/demo` route with mock data:
- `/demo/login`, `/demo/register` — Auth pages
- `/demo/dashboard` — Dashboard with stats, recent imports, activity
- `/demo/products` — Master products table with search/filter/pagination
- `/demo/products/upload` — 4-step upload wizard (Upload → Preview → Map Columns → Import) with AI confidence scores, sample data, column types, transforms, quality checks, duplicate detection, recent uploads
- `/demo/categories` — Category tree view with search, bulk actions, import/export, breadcrumbs, stats
- `/demo/import` — Import sessions list with stats bar, search, sort, tags, duration, actions menu, completed summary
- `/demo/import/new` — New import with notes, file quality checks, duplicate detection, AI column mapping preview, import settings, recent suppliers sidebar
- `/demo/import/session/rules` — Matching rules with presets, drag reorder, multi-example preview, test SKU, match quality score, AI suggestion
- `/demo/import/session/review` — Review results with summary cards, search/filter, approve/reject per row, diff visualization, bulk actions, impact summary, export report
- `/demo/usage` — Usage & analytics page (replaces Export in sidebar)
- `/demo/team` — Team management with invites and role permissions
- `/demo/settings` — Workspace settings with CMS type (no API config section)
- `/demo/workspaces` — Workspace list + create with CMS Type field

---

## Target Architecture

### User Flow (Updated)
```
Register/Login
  -> Create Workspace (name, CMS type, description)
  -> Upload Master Data (one-time)
     |- Products (Excel/CSV with SKU) — 4-step wizard
     |- Categories (Excel/CSV or manual tree)
  -> Receive Supplier Sheet
  -> New Import (upload file + notes + quality checks + AI column preview)
  -> Matching Rules (SKU rules + presets + live preview + test SKU)
  -> Review Results (approve/reject per row + diff viz + bulk actions)
  -> Continue to Enrichment Tool (reads from import_rows directly)
     |- Existing sheet -> approved updates (read-only confirmation)
     |- New sheet -> AI Enrichment (writes to import_rows.enriched_data)
     |- "Add to Master" -> creates master_products from enriched import_rows
  -> Usage & Analytics (track API usage, enrichment stats)
```

**NOTE**: Column Mapping has been **removed** as a separate step. It is now handled:
- As an **AI auto-preview** in the New Import page (before matching)
- As **column mapping in the Upload Products wizard** (Step 3)

### New Database Tables (15 total)
1. profiles
2. workspaces (+ cms_type field)
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
13. subscription_plans (system table — defines the 3 plan tiers)
14. workspace_subscriptions (which plan each workspace is on + billing cycle)
15. credit_transactions (log of every AI credit consumed or added)

### Subscription Plans (3 Tiers)
The platform has 3 subscription tiers. Details will be finalized later, but the structure supports per-tier feature limits and AI credit allowances.

| | Starter | Pro | Enterprise |
|---|---|---|---|
| Workspaces | TBD | TBD | TBD |
| Members | TBD | TBD | TBD |
| Products | TBD | TBD | TBD |
| Imports/month | TBD | TBD | TBD |
| AI Credits/month | TBD | TBD | TBD |
| Storage | TBD | TBD | TBD |
| Priority support | No | Yes | Yes |

> **NOTE**: Exact limits for each tier will be provided later. The system is designed to accommodate any values.

### AI Credits System
**Credits are consumed EXCLUSIVELY by AI operations.** No other operation costs credits.

AI operations that consume credits:
- **AI Enrichment** (per row): generating enhanced titles, descriptions, SEO keywords, etc.
- **AI Image Search** (per query): searching for product images via AI
- **AI Column Mapping** (per import): auto-detecting column types and mappings
- **AI Category Suggestion** (per product): suggesting categories for new products (future)

Non-AI operations (NO credit cost):
- Uploading files, importing data, matching SKUs, exporting, managing team, etc.

Credits are tracked per-workspace and reset monthly based on subscription plan.

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
| View Usage/Analytics | Yes | Yes | Yes | Yes |
| View (read-only) | Yes | Yes | Yes | Yes |

---

## Phases Summary

| Phase | Description | Priority |
|-------|-------------|----------|
| **1A** | Auth (Login/Register/Reset + middleware + profiles) | High |
| **1B** | Workspaces (CRUD + slug routing + switcher + layout + CMS type) | High |
| **1C** | Team & Roles (RBAC + invite system + team page) | High |
| **2A** | Master Data (Categories tree + Products upload/table) | High |
| **2B** | Supabase Storage (file upload/download/preserve originals) | High |
| **3A** | Supplier Import (upload + notes + quality checks + AI column preview) | High |
| **3B** | Matching Engine (SKU rules + presets + preview + test + split Existing/New) | High |
| **3C** | Review & Enrich (Approve/reject + diff viz + bulk actions + enrichment tool) | High |
| **4A** | Usage & Analytics (AI credits tracking, subscription plans, enrichment stats, usage limits) | Medium |
| **5** | Advanced (Dashboard stats + activity log + notifications) | Low |

---

## New Dependencies to Install

```
npm install @supabase/ssr
```

No other new packages needed — everything else is already in package.json.
