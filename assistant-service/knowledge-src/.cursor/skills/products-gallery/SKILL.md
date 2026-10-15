---
name: products-gallery
description: Create and run Products Gallery projects (upload a product sheet, then find real product images from the web or generate studio images). Use for any request about product images, gallery images, main images, image generation or the Products Gallery page.
---

# Products Gallery

Page: `/w/{slug}/products-gallery`. A project is opened with `?project={id}` (clicking its card does that).

Read the page with `gallery_get_state` first. Without an open project it lists the projects; with one open it returns the mode, the settings, row counts by status, the selected rows and whether a run is active.

Flow, with the control ids from `see_page`:

1. **New project**: `gallery.new-project` opens the dialog.
   - `gallery.create.name` (text), then `upload_file` on `gallery.create.file` with the attached file id (CSV or Excel).
   - `gallery.create.submit` creates the project and opens it. It is free.
2. **Open an existing project**: click `gallery.project.{id}` (ids come from `gallery_get_state`).
3. **Choose the mode**:
   - `gallery.mode.scraping` finds real product images on the web.
   - `gallery.mode.ai` generates new studio images, optionally from the original product photo.
4. **Settings** (dropdowns, use `type` with the option text): ids start with `gallery.setting.` (for example images per product, research depth, resolution, aspect ratio, style). `gallery.image-column` picks the sheet column that holds the original image URL.
   - Text instructions: `gallery.scraping.instructions` or `gallery.ai.instructions`.
   - AI quality: `gallery.ai.quality.standard` or `gallery.ai.quality.premium` (premium costs more).
   - Keep the defaults unless the user asked for something specific.
5. **Rows**: choose them with `gallery_select_rows` (all, none, indexes, or status such as `not_started` or `failed`). `gallery.search` and `gallery.filter` narrow the visible rows; `all` selects the visible rows only.
6. **Run**: `gallery.run` spends credits. Do `ask_confirmation` first (mode, how many products, images per product, quality), then `click` with the token. `gallery.stop` stops a running job.
7. After a run, call `gallery_get_state` and report the status counts. Runs take a while; use `wait_for` or check `running` and `progress` again instead of clicking run twice.

Rules of thumb:
- Never run on every product without saying how many that is.
- Re-running rows that are already `ready` or `failed` costs credits again; ask first.
- If `gallery.run` is disabled, either no rows are selected, a run is already active, or the user cannot edit this project. Say which.
- `gallery.export` opens the export dialog; it is free.
