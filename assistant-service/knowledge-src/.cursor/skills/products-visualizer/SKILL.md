---
name: products-visualizer
description: Create and run Products Visualizer projects (upload a product sheet, then generate SEO product descriptions and matching lifestyle images). Use for any request about product descriptions with images, product stories, lifestyle visuals or the Products Visualizer page.
---

# Products Visualizer

Page: `/w/{slug}/products-visualizer`. A project is opened with `?project={id}` (clicking its card does that).

Read the page with `visualizer_get_state` first. Without an open project it lists the projects; with one open it returns the product image column, the available and chosen input columns, the settings, row counts by status, the selected rows, `readyToGenerate` and whether a run is active.

Flow, with the control ids from `see_page`:

1. **New project**: `visualizer.new-project` opens the dialog.
   - `visualizer.create.name` (text), then `upload_file` on `visualizer.create.file` with the attached file id (CSV or Excel).
   - `visualizer.create.submit` creates the project. It is free. Then open it from the list (`visualizer.project.{id}`) if it did not open by itself.
2. **Product image column** (required): `visualizer.setting.product-image-column`, a dropdown; use `type` with the column name. Only columns whose cells are image URLs are offered (`imageColumnCandidates`). If there are none, tell the user the sheet needs a column of http(s) image links.
3. **Input columns** (required): `visualizer_set_columns` with the header names that describe the product (name, brand, specs, materials…). Do not include the image column. Choose sensible ones from `availableColumns` and say which you picked.
4. **Settings** (keep the defaults unless the user asked):
   - Quality: `visualizer.quality.standard` or `visualizer.quality.premium` (premium costs more).
   - `visualizer.instructions`: tone, keywords, claims to stress or avoid.
   - `visualizer.branding` toggles branding. Logo and brand guide uploads, colours and the layout dialog are for the user to do; point them to the control.
   - Settings are saved automatically when a run starts; `visualizer.save` saves them now.
5. **Rows**: `visualizer_select_rows` (all, none, indexes, or status such as `not_started`, `failed`, `description_ready`, `images_ready`). Rows that are already generating are skipped; `selectedThatWillRun` is what a run will cover.
6. **Run**: `visualizer.run` spends credits. Each product gets a description and then its images. Do `ask_confirmation` first (how many products, images per product, quality), then `click` with the token. `visualizer.stop` stops a running job.
7. After a run, call `visualizer_get_state` and report the status counts. Runs take a while; check `running` and `progress` again instead of clicking run twice.

Rules of thumb:
- If `readyToGenerate` is false, the image column or the input columns are missing. Fix that (or ask) before asking for approval.
- Never run on every product without saying how many that is.
- Re-running rows that are `description_ready`, `images_ready` or `failed` costs credits again; ask first.
- `visualizer.export` opens the export dialog; it is free. `visualizer.back` returns to the project list.
