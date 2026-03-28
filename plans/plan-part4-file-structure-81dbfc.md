# Part 4: Complete File Structure

Every new and modified file in the project, organized by directory.

> **⚠️ UPDATED** — Reflects removal of Column Mapping step, addition of CMS type, Usage page replacing Export, enhanced import flow, Existing/New sheet toggle, and Functions tab. **Old `/projects` and `/project/[id]` pages will be DELETED** — enrichment tool now accessed from Review page at `/w/[slug]/import/[id]/enrich`. **Added**: subscription/credits files (lib, API routes, hooks) for 3-tier subscription plans and AI credits system.

---

## New Directory Tree

```
src/
  app/
    (auth)/                                    -- PUBLIC: Auth pages (no dashboard layout)
      layout.tsx                               -- Centered minimal layout (logo + card)
      login/
        page.tsx                               -- Email + password login form
      register/
        page.tsx                               -- Full name + email + password + confirm
      forgot-password/
        page.tsx                               -- Email input -> sends reset link
      reset-password/
        page.tsx                               -- New password form (from email link)
      invite/
        [token]/
          page.tsx                             -- Accept workspace invite (register or join)

    (dashboard)/                               -- PROTECTED: Requires auth
      layout.tsx                               -- Auth guard + global top bar + workspace switcher
      page.tsx                                 -- Router: has workspaces? -> default ws, else -> /workspaces/new

      workspaces/
        page.tsx                               -- Grid of workspace cards
        new/
          page.tsx                             -- Create workspace form (name, CMS type, description -> auto slug)

      w/[workspaceSlug]/                       -- WORKSPACE SCOPE: Everything inside a workspace
        layout.tsx                             -- Load workspace + sidebar nav + role context
        page.tsx                               -- Dashboard: stats cards, recent activity, quick actions

        products/
          page.tsx                             -- Master products table (search, filter, paginate)
          upload/
            page.tsx                           -- 4-step upload wizard: Upload File -> Preview -> Map Columns -> Import
                                               --   Step 1: Drag-drop with file info, sheet selector, recent uploads
                                               --   Step 2: Data preview with search, quality checks, column types
                                               --   Step 3: AI column mapping with confidence scores, transforms, sample data
                                               --   Step 4: Duplicate handling, match by field, progress bar, live counter

        categories/
          page.tsx                             -- Category tree with search, bulk actions, import/export, breadcrumbs, stats

        import/
          page.tsx                             -- Import sessions list with:
                                               --   Stats bar (4 cards), search, sort, filter tabs with counts
                                               --   Tags, duration, completed result summary, actions menu
          new/
            page.tsx                           -- New import with:
                                               --   Session name, supplier, notes field
                                               --   File upload with quality checks (rows/cols/encoding)
                                               --   Duplicate detection warning
                                               --   AI column mapping preview (auto-detect, confidence scores)
                                               --   Import settings (skip empty, trim, encoding)
                                               --   Right sidebar: recent suppliers, quick tips, import stats
          [sessionId]/
            page.tsx                           -- Session overview (current step, stats)
            rules/
              page.tsx                         -- Step 1: Matching Rules with:
                                               --   Rule presets (Samsung/Dell/Generic formats)
                                               --   Drag reorder, toggle rules, value config
                                               --   Multi-example live preview table (5 samples)
                                               --   Test-a-SKU feature (manual input -> instant result)
                                               --   Match quality score + before/after rule impact
                                               --   AI suggestion card
            review/
              page.tsx                         -- Step 2: Review Results with:
                                               --   6 summary cards (matched, new, price/stock changes, approved/rejected)
                                               --   Price impact + stock change impact summary
                                               --   Big change alerts (>10% price changes)
                                               --   Approve/reject per row with checkboxes
                                               --   Diff visualization (trend arrows, percentage, color-coded)
                                               --   Search + filter (all/price/stock)
                                               --   Bulk actions (approve all, reject all)
                                               --   Export report button
                                               --   Continue -> opens enrichment tool
            enrich/
              page.tsx                         -- Step 3: Enrichment Tool (reuses data-table + sidebar)
                                               --   Reads from import_rows (NOT old projects/rows tables)
                                               --   Existing/New sheet toggle in header
                                               --   Existing: approved updates (read-only)
                                               --   New: AI enrichment -> writes to import_rows.enriched_data
                                               --   "Add to Master" button -> creates master_products

        usage/
          page.tsx                             -- Usage & analytics (API calls, enrichment stats, limits)

        team/
          page.tsx                             -- Team members table + invite dialog

        settings/
          page.tsx                             -- Workspace settings (name, CMS type, defaults, danger zone)
                                               --   NO API config section (managed globally)

      profile/
        page.tsx                               -- User profile (name, avatar, password change)

    api/
      auth/
        callback/
          route.ts                             -- Supabase auth callback (email confirm + reset)
      enrich/
        route.ts                               -- (EXISTING) SSE enrichment API - REFACTOR to read/write import_rows
      import/
        match/
          route.ts                             -- Run matching algorithm, return results
        apply/
          route.ts                             -- Apply approved updates to master_products
      usage/
        route.ts                               -- Track and return usage statistics + AI credits balance
      subscription/
        route.ts                               -- Get/update workspace subscription, check limits
      credits/
        route.ts                               -- Get credit balance, log credit transactions
        deduct/
          route.ts                             -- Deduct credits for AI operation (called by enrich API)

    layout.tsx                                 -- (EXISTING) Root layout - add auth listener
    page.tsx                                   -- (MODIFY) Check auth: logged in -> /workspaces, else -> /login
    globals.css                                -- (EXISTING) No changes

  components/
    auth/
      login-form.tsx                           -- Login form: email, password, validation, error display
      register-form.tsx                        -- Register form: name, email, password, confirm
      auth-guard.tsx                           -- Client component: check session, redirect if none

    workspace/
      workspace-switcher.tsx                   -- Header dropdown: list workspaces + "Create new"
      workspace-sidebar.tsx                    -- Left nav: Dashboard, Products, Categories, Import, Usage, Team, Settings
      workspace-card.tsx                       -- Card for workspace list (name, members, products count, CMS type)
      invite-dialog.tsx                        -- Dialog: email input + role selector + send
      team-table.tsx                           -- Table: name, email, role, date, actions

    products/
      products-table.tsx                       -- DataTable for master products (reuse TanStack patterns)
      product-upload-wizard.tsx                -- 4-step wizard with AI mapping, quality checks, transforms
      product-detail-panel.tsx                 -- Side panel: all product fields + enriched data

    categories/
      category-tree.tsx                        -- Interactive tree: expand/collapse, search, bulk actions
      category-form.tsx                        -- Add/edit category dialog (name, parent, description)
      category-stats.tsx                       -- Stats bar: total, root, with products, max depth

    import/
      import-stepper.tsx                       -- Step indicator: Rules -> Review -> Enrichment Tool (3 steps)
      file-upload-step.tsx                     -- Upload supplier file + name + notes + quality checks
      ai-column-preview.tsx                    -- AI auto-detect column mapping with confidence badges
      matching-rules-editor.tsx                -- Toggle/configure rules + presets + drag reorder
      rule-presets.tsx                         -- Preset configurations (Samsung, Dell, Generic)
      match-preview.tsx                        -- Live preview table + test-a-SKU + quality score
      review-summary.tsx                       -- Summary cards + impact summary + big change alerts
      review-table.tsx                         -- Approve/reject per row + diff visualization + bulk actions
      existing-products-sheet.tsx              -- Existing tab in enrichment tool
      new-products-sheet.tsx                   -- New tab in enrichment tool for AI enrichment

    -- EXISTING (keep, some will be modified):
    data-table.tsx                             -- (MODIFY) Add Existing/New sheet toggle in header
    sidebar.tsx                                -- (MODIFY) Add Functions tab alongside enrichment config
    enrichment-panel.tsx                       -- (KEEP) Enrichment progress
    file-upload.tsx                            -- (KEEP) Generic file upload
    header.tsx                                 -- (MODIFY) Add user menu + workspace switcher
    ui/                                        -- (KEEP) All 15 shadcn components

  lib/
    supabase.ts                                -- (REWRITE) Remove old projects/rows CRUD, add new workspace/import CRUD
    supabase-server.ts                         -- NEW: Server-side Supabase client (createServerClient)
    supabase-storage.ts                        -- NEW: Upload/download/delete files from Storage bucket
    auth.ts                                    -- NEW: signUp, signIn, signOut, resetPassword, getUser
    permissions.ts                             -- NEW: canEdit(role), canAdmin(role), isOwner(role)
    matching.ts                                -- NEW: SKU matching with presets + normalizeValue + buildIndex
    export-formats.ts                          -- NEW: Platform column mappings (Shopify, Woo, Salla, etc.)
    export-generators.ts                       -- NEW: Generate CSV/XLSX in platform-specific format
    credits.ts                                 -- NEW: checkCredits, deductCredits, getBalance, logTransaction
    subscriptions.ts                           -- NEW: getPlan, getSubscription, checkLimit, canPerformAction
    gemini.ts                                  -- (KEEP) AI search + enrich + image search
    prompts.ts                                 -- (KEEP) Prompt builders
    excel.ts                                   -- (MODIFY) Add new parsers for categories
    persistence.ts                             -- (KEEP) Local session persistence
    utils.ts                                   -- (KEEP) cn() helper

  store/
    sheet-store.ts                             -- (REFACTOR) Load from import_rows instead of old rows table
    auth-store.ts                              -- NEW: User session state (user, profile, isLoading)
    workspace-store.ts                         -- NEW: Current workspace, role, members

  hooks/
    use-auth.ts                                -- NEW: Current user + onAuthStateChange listener
    use-workspace.ts                           -- NEW: Load workspace by slug + provide context
    use-role.ts                                -- NEW: Check permissions for current user in workspace
    use-supabase.ts                            -- NEW: Typed Supabase client hook
    use-credits.ts                             -- NEW: Credit balance, remaining, check before AI ops
    use-subscription.ts                        -- NEW: Current plan, limits, upgrade prompts

  types/
    index.ts                                   -- (MODIFY) Expand with new types
    database.ts                                -- NEW: Supabase generated DB types
    platforms.ts                               -- NEW: Export platform type definitions

  middleware.ts                                -- NEW: Next.js middleware (auth redirect logic)

---

## Files to DELETE (old project flow)

```
src/app/projects/page.tsx              -- Old project list (replaced by /w/[slug]/import)
src/app/project/[id]/page.tsx          -- Old project view (replaced by /w/[slug]/import/[id]/enrich)
```

> All `createProject`, `deleteProject`, `duplicateProject`, `getProject`, `getProjects`, `getProjectRows`, `insertRows`, `updateRow`, `updateRowsBatch`, `deleteRows`, `saveProjectState` functions in `supabase.ts` will be removed and replaced with new workspace-scoped CRUD.

## Files Summary

| Category | New Files | Modified/Refactored | Deleted | Kept As-Is |
|----------|-----------|---------------------|---------|------------|
| App pages | 23 | 2 | 2 | 0 |
| API routes | 7 | 1 | 0 | 0 |
| Components | 20 | 3 | 0 | 4 |
| Lib | 8 | 2 (rewrite) | 0 | 3 |
| Store | 2 | 1 (refactor) | 0 | 0 |
| Hooks | 6 | 0 | 0 | 0 |
| Types | 2 | 1 | 0 | 0 |
| Other | 1 (middleware) | 0 | 0 | 0 |
| **Total** | **69** | **10** | **2** | **7** |
