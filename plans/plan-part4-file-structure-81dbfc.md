# Part 4: Complete File Structure

Every new and modified file in the project, organized by directory.

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
          page.tsx                             -- Create workspace form (name -> auto slug)

      w/[workspaceSlug]/                       -- WORKSPACE SCOPE: Everything inside a workspace
        layout.tsx                             -- Load workspace + sidebar nav + role context
        page.tsx                               -- Dashboard: stats cards, recent activity, quick actions

        products/
          page.tsx                             -- Master products table (search, filter, paginate)
          upload/
            page.tsx                           -- Upload wizard: file -> preview -> column map -> confirm

        categories/
          page.tsx                             -- Category tree view (expand/collapse, CRUD)
          upload/
            page.tsx                           -- Upload categories from file

        import/
          page.tsx                             -- List all import sessions (cards with status badges)
          new/
            page.tsx                           -- Start new import: upload file + name + supplier
          [sessionId]/
            page.tsx                           -- Session overview (current step, stats)
            mapping/
              page.tsx                         -- Step 1: Column Mapping UI
            rules/
              page.tsx                         -- Step 2: Matching Rules + preview results
            review/
              page.tsx                         -- Step 3: Tabs [Existing (diff) | New (to enrich)]
            enrich/
              page.tsx                         -- Step 4: AI Enrichment (reuse existing system)

        export/
          page.tsx                             -- Export wizard: select data -> platform -> mapping -> preview -> download

        team/
          page.tsx                             -- Team members table + invite dialog

        settings/
          page.tsx                             -- Workspace settings (name, logo, defaults, danger zone)

      profile/
        page.tsx                               -- User profile (name, avatar, password change)

    api/
      auth/
        callback/
          route.ts                             -- Supabase auth callback (email confirm + reset)
      enrich/
        route.ts                               -- (EXISTING) SSE enrichment API - keep as-is
      import/
        match/
          route.ts                             -- Run matching algorithm, return results
        apply/
          route.ts                             -- Apply updates to master_products
      export/
        generate/
          route.ts                             -- Generate export file in platform format

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
      workspace-sidebar.tsx                    -- Left nav: Dashboard, Products, Categories, Import, Export, Team, Settings
      workspace-card.tsx                       -- Card for workspace list (name, members, products count)
      invite-dialog.tsx                        -- Dialog: email input + role selector + send
      team-table.tsx                           -- Table: name, email, role, date, actions

    products/
      products-table.tsx                       -- DataTable for master products (reuse TanStack patterns)
      product-upload-wizard.tsx                -- Multi-step: upload -> preview -> map -> confirm
      product-detail-panel.tsx                 -- Side panel: all product fields + enriched data

    categories/
      category-tree.tsx                        -- Interactive tree: expand/collapse, click to edit
      category-form.tsx                        -- Add/edit category dialog (name, parent, description)
      category-upload-wizard.tsx               -- Upload categories from CSV/Excel

    import/
      import-stepper.tsx                       -- Step indicator bar: Mapping -> Rules -> Review -> Enrich
      file-upload-step.tsx                     -- Upload supplier file + name the session
      column-mapping.tsx                       -- Visual mapping: supplier cols (left) <-> system cols (right)
      matching-rules-editor.tsx                -- Toggle/configure matching rules
      match-preview.tsx                        -- Results: X matched, Y new, Z ambiguous + sample table
      existing-products-sheet.tsx              -- Existing tab: diff table (old vs new values)
      new-products-sheet.tsx                   -- New tab: products for AI enrichment
      diff-cell.tsx                            -- Cell component: red strikethrough old -> green new

    export/
      platform-selector.tsx                    -- Grid of platform cards (logo + name + description)
      export-mapping-editor.tsx                -- Map system fields to platform fields
      export-preview.tsx                       -- Preview first 5 rows of export + download button

    -- EXISTING (keep, some will be modified):
    data-table.tsx                             -- (KEEP) Main data table for enrichment view
    sidebar.tsx                                -- (KEEP) Enrichment config sidebar
    enrichment-panel.tsx                       -- (KEEP) Enrichment progress
    export-button.tsx                          -- (MODIFY) Enhance with platform selection
    file-upload.tsx                            -- (KEEP) Generic file upload
    header.tsx                                 -- (MODIFY) Add user menu + workspace switcher
    ui/                                        -- (KEEP) All 15 shadcn components

  lib/
    supabase.ts                                -- (MODIFY) Expand with new CRUD functions
    supabase-server.ts                         -- NEW: Server-side Supabase client (createServerClient)
    supabase-storage.ts                        -- NEW: Upload/download/delete files from Storage bucket
    auth.ts                                    -- NEW: signUp, signIn, signOut, resetPassword, getUser
    permissions.ts                             -- NEW: canEdit(role), canAdmin(role), isOwner(role)
    matching.ts                                -- NEW: SKU matching algorithms (applyRules, matchProducts)
    export-formats.ts                          -- NEW: Platform column mappings (Shopify, Woo, Salla, etc.)
    export-generators.ts                       -- NEW: Generate CSV/XLSX in platform-specific format
    gemini.ts                                  -- (KEEP) AI search + enrich + image search
    prompts.ts                                 -- (KEEP) Prompt builders
    excel.ts                                   -- (MODIFY) Add new parsers for categories
    persistence.ts                             -- (KEEP) Local session persistence
    utils.ts                                   -- (KEEP) cn() helper

  store/
    sheet-store.ts                             -- (KEEP) Zustand store for enrichment
    auth-store.ts                              -- NEW: User session state (user, profile, isLoading)
    workspace-store.ts                         -- NEW: Current workspace, role, members

  hooks/
    use-auth.ts                                -- NEW: Current user + onAuthStateChange listener
    use-workspace.ts                           -- NEW: Load workspace by slug + provide context
    use-role.ts                                -- NEW: Check permissions for current user in workspace
    use-supabase.ts                            -- NEW: Typed Supabase client hook

  types/
    index.ts                                   -- (MODIFY) Expand with new types
    database.ts                                -- NEW: Supabase generated DB types
    platforms.ts                               -- NEW: Export platform type definitions

  middleware.ts                                -- NEW: Next.js middleware (auth redirect logic)
```

---

## Files Summary

| Category | New Files | Modified Files | Kept As-Is |
|----------|-----------|----------------|------------|
| App pages | 24 | 2 | 1 |
| API routes | 4 | 0 | 1 |
| Components | 22 | 2 | 6 |
| Lib | 6 | 2 | 4 |
| Store | 2 | 0 | 1 |
| Hooks | 4 | 0 | 0 |
| Types | 2 | 1 | 0 |
| Other | 1 (middleware) | 0 | 0 |
| **Total** | **65** | **7** | **13** |
