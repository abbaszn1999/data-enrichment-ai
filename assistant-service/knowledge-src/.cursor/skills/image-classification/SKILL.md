---
name: image-classification
description: Create and run Image Classification projects (upload a batch of product photos and sort them into groups of the same product, with the SKU read from each photo). Use for any request about classifying, grouping, sorting or matching product images, or the Image Classification page.
---

# Image Classification

Pages:
- `/w/{slug}/image-classify`: the project list. `classify.new-project` opens the form; `classify.project.{id}` opens a finished project.
- `/w/{slug}/image-classify/new`: the form for a new batch.
- `/w/{slug}/image-classify/{id}`: the result of one project.

Read the page with `classify_get_state` first. Its `view` is `projects`, `new` or `result`.

Flow for a new batch, with the control ids from `see_page`:

1. The images come from the user: they attach them in the chat (up to 200 JPEG, PNG, WebP or GIF). If none are attached, ask them to attach the photos; you cannot pick files from their computer.
2. Open `/w/{slug}/image-classify/new` (or click `classify.new-project`).
3. `classify.new.name` (text): a project name. Use what the user said, or a short descriptive name.
4. `classify.new.instruction` (optional): how to group, e.g. "group by colour", "the SKU is printed on the label". Leave it empty unless the user gave guidance.
5. `classify.new.thinking` (dropdown, keep `medium` unless asked): `minimal`, `low`, `medium` or `high`. Higher is more careful on hard batches and can cost more.
6. `upload_file` on `classify.new.file` with `fileIds` set to every attached image id, in one call. The page prepares previews; call `classify_get_state` until `phase` is `idle` and `images` shows the count.
7. **Run**: `classify.new.submit` spends credits for the whole batch. Do `ask_confirmation` first (how many images, the instruction, the thinking level), then `click` with the token.
8. The page uploads the photos, classifies them and then opens the result page by itself. This takes a while; use `wait_for` or call `classify_get_state` again instead of clicking twice.
9. On the result page, report the number of groups, the largest groups and any SKUs found. `classify.export.csv` and `classify.export.json` download the result for free.

Rules of thumb:
- If `canSubmit` is false, the name or the images are missing, or a run is already in progress.
- `canCreate` false means the user has no permission to create projects; say so and stop.
- If the result has `status` `failed`, tell the user the `error` and offer to try again (it costs credits again; ask first).
- Do not add images that the user did not attach, and never upload the same batch twice.
- `classify.back` returns to the project list.
