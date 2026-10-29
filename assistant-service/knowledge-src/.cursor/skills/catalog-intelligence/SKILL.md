---
name: catalog-intelligence
description: Create and run Catalog Intelligence projects (upload a supplier sheet, match, pick output columns, enrich, review). Use for any request about catalog sheets, enrichment, product rows or categories in the dashboard.
---

# Catalog Intelligence

Flow, with the control ids from `see_page`:

0. **Project list** — `/w/{slug}/catalog-intelligence`. Each project is `ci.project.{id}` (label: name · status); clicking it opens the project on its current step. `ci.new-project` starts a new one. Only one page of projects is on screen: to find a project by name, use `list_projects` with tool `catalog` and navigate to its `open` path.
1. **New project** — `/w/{slug}/catalog-intelligence/new`
   - Kind: `ci.new.kind.product` (product enrichment) or `ci.new.kind.plp` (category pages).
   - `ci.new.session-name` (text), `ci.new.supplier` (dropdown, product only), `ci.new.supplier-name` (when "+ New Supplier").
   - File: `upload_file` on `ci.new.file` with the id of the attached file. Wait for the row and column counts to appear.
   - `ci.new.submit` creates the project and opens the next step. It is free.
2. **Matching rules** — `ci.rules.continue` (product only). Keep defaults unless the user asked otherwise.
3. **Review** — `ci.review.continue` opens the workspace.
4. **Workspace** (`/w/{slug}/catalog-intelligence/{projectId}`)
   - Tools in the rail: `ci.mode.enrich` (Enrichment), `ci.mode.categories` (Categorize), `ci.mode.sources` (Source Finder: finds the product pages) and `ci.mode.images` (Image Finder: finds product images; it opens with the Source URLs column ticked as a source when the sheet has one), `ci.mode.lens` (Lens Source Checker: finds product pages from one picture per row; it needs a column of image links, which Image Finder can fill first) and `ci.mode.functions` (Sheet Tools: bulk edits, prices, cleanup). Clicking the open tool hides its panel; `ci_get_state` shows which tool is open (`mode`).
   - Sheet Tools has its own panel that you cannot operate yet; open it with `ci.mode.functions` and tell the user what to do there.
   - Read the sheet with `ci_get_state`; choose rows with `ci_select_rows`.
   - What `ci.run` runs depends on the open tool; `ci_get_state` says it in `tool` and `willRun`:
     - Enrichment: the output columns that are on. Turn them on or off with `ci_set_columns` (by label) or `ci.col.{id}`.
     - Source Finder / Image Finder: two separate tools, each with one output (`finderOutput`: Source URLs or Images). Open the one you need with `ci.mode.sources` or `ci.mode.images`; its card (`ci.finder.source-urls` or `ci.finder.images`) only opens or closes the instructions.
     - Lens Source Checker: always Lens, from one picture column (`pictureColumn`). The "Picture column" dropdown in the panel (`ci.lens.picture-column`) lists the columns that hold picture links and is filled in automatically; use `type` with the column name to change it.
     - Categorize: the category column. Sheet Tools: nothing to run.
   - Run: `ci.run` spends credits. Do `ask_confirmation` first (the tool, what it runs from `willRun`, how many rows), then `click` with the token. `ci.stop` stops a running job.
5. After a run, call `ci_get_state` and report row status counts. Do not re-run failed rows without asking: that costs credits again.

Rules of thumb:
- Never run on all rows without telling the user how many that is.
- Selected rows decide what a run covers. Check `selectedRows` before asking for approval.
- If `ci.run` is disabled, either nothing is set to run (`willRun` is empty), no rows are selected, or a required source column is missing (for Lens, a picture column). Say which.
- If `toolPanelOpen` is false, the tool's panel is hidden: click its `ci.mode.*` button to show it before using its controls.
