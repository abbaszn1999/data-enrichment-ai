---
name: catalog-intelligence
description: Create and run Catalog Intelligence projects (upload a supplier sheet, match, pick output columns, enrich, review). Use for any request about catalog sheets, enrichment, product rows or categories in the dashboard.
---

# Catalog Intelligence

Flow, with the control ids from `see_page`:

1. **New project** — `/w/{slug}/catalog-intelligence/new`
   - Kind: `ci.new.kind.product` (product enrichment) or `ci.new.kind.plp` (category pages).
   - `ci.new.session-name` (text), `ci.new.supplier` (dropdown, product only), `ci.new.supplier-name` (when "+ New Supplier").
   - File: `upload_file` on `ci.new.file` with the id of the attached file. Wait for the row and column counts to appear.
   - `ci.new.submit` creates the project and opens the next step. It is free.
2. **Matching rules** — `ci.rules.continue` (product only). Keep defaults unless the user asked otherwise.
3. **Review** — `ci.review.continue` opens the workspace.
4. **Workspace** (`/w/{slug}/catalog-intelligence/{projectId}`)
   - Tools in the rail: `ci.mode.enrich` (Enrichment), `ci.mode.categories` (Categorize), `ci.mode.images` (Source / Image Finder), `ci.mode.lens` (Lens Source Checker: finds product pages from one picture per row; it needs a column of image links, which Image Finder can fill first) and `ci.mode.functions` (Sheet Tools: bulk edits, prices, cleanup). Clicking the open tool hides its panel; `ci_get_state` shows which tool is open (`mode`).
   - Sheet Tools has its own panel that you cannot operate yet; open it with `ci.mode.functions` and tell the user what to do there.
   - Read the sheet with `ci_get_state`; choose rows with `ci_select_rows`; choose output columns with `ci_set_columns` (by label) or `ci.col.{id}`.
   - Run: `ci.run` spends credits. Do `ask_confirmation` first (what runs, how many rows, which columns), then `click` with the token. `ci.stop` stops a running job.
5. After a run, call `ci_get_state` and report row status counts. Do not re-run failed rows without asking: that costs credits again.

Rules of thumb:
- Never run on all rows without telling the user how many that is.
- Selected rows decide what a run covers. Check `selectedRows` before asking for approval.
- If `ci.run` is disabled, either no output column is on, no rows are selected, or a required source column is missing. Say which.
