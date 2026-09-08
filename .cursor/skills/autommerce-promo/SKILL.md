---
name: autommerce-promo
description: Build the Autommerce Data Entry 60s SaaS promo video in the isolated promo-video/ folder using Remotion. Use when creating, editing, or rendering the product promo, teaser, intro video, or marketing campaign for Autommerce Data Entry.
---

# Autommerce Data Entry — Promo Video Skill

All promo work lives in **`promo-video/`** — never modify the main Next.js app (`src/`, `package.json` at repo root).

## Related skills (use together)

1. **remotion-best-practices** — Remotion code rules (`.cursor/skills/remotion-best-practices/`)
2. **remotion-promo-video-factory** — workflow, QA, timing, blueprints
3. **promo-video** — ElevenLabs voiceover, music, ffmpeg render

## Isolated project paths

| Path | Purpose |
|------|---------|
| `promo-video/brief.md` | 60s scene plan — read first |
| `promo-video/assets/brand/` | logo.png, brand.json |
| `promo-video/assets/screenshots/` | UI PNG captures |
| `promo-video/assets/data/demo-products.json` | Staged enrichment rows |
| `promo-video/autommerce-60s/` | Remotion project |
| `promo-video/out/` | Rendered MP4 exports |

## Product context

- **Name:** Autommerce Data Entry
- **Audience:** E-commerce catalog managers, marketplace sellers, agencies
- **Promise:** Turn messy supplier data into SEO-ready, store-ready catalogs with AI
- **Blueprint:** AI/automation app + UI-centric app (see remotion-promo-video-factory)
- **Hero feature:** AI enrichment spreadsheet (longest scene hold)
- **Differentiator:** Shopify / WooCommerce sync with AI chat

## Main app reference (read-only — do NOT import into Remotion)

Use these only for visual reference or screenshot capture — not direct imports (Supabase/auth dependencies):

- `src/components/sidebar.tsx` — enrichment controls
- `src/components/data-table.tsx` — spreadsheet grid
- `src/app/(dashboard)/w/[workspaceSlug]/sync/page.tsx` — sync UI
- `src/app/globals.css` — brand colors (also in `promo-video/assets/brand/brand.json`)

## Workflow

### Step 1: Verify assets

Check `promo-video/assets/README.md`. Minimum before first render:

- [ ] `assets/brand/logo.png`
- [ ] At least scenes 05-enrich and 01-dashboard screenshots
- [ ] `brief.md` reviewed

Copy assets into Remotion public folder when using `staticFile()`:

```bash
# From repo root (PowerShell)
Copy-Item promo-video/assets/brand/logo.png promo-video/autommerce-60s/public/logo.png -ErrorAction SilentlyContinue
Copy-Item promo-video/assets/screenshots/*.png promo-video/autommerce-60s/public/ -ErrorAction SilentlyContinue
```

### Step 2: Build / edit composition

Work only inside `promo-video/autommerce-60s/src/`:

- `AutommercePromo60s.tsx` — main composition
- `scenes/` — one file per scene from brief.md
- `constants/brand.ts` — colors, fonts, copy
- `constants/timing.ts` — scene durations in seconds

Composition spec:

- **ID:** `AutommercePromo60s`
- **Size:** 1920×1080
- **FPS:** 30
- **Duration:** 60 seconds (1800 frames)

Story arc: `Hook → Problem → Reveal → Import → Enrich → Export → Sync → Scale → CTA`

### Step 3: Preview

```bash
cd promo-video/autommerce-60s
npm run dev
```

### Step 4: QA (required)

Follow `remotion-promo-video-factory` Step 9 — capture key frames after major changes. Do not claim done without visual check.

### Step 5: Voiceover + music (optional)

Follow `promo-video` skill Phase 4–5. Requires `promo-video/.env` with `ELEVEN_LABS_API_KEY`.

### Step 6: Render

```bash
cd promo-video/autommerce-60s
npx remotion render AutommercePromo60s ../out/promo-hq.mp4 --image-format png --crf 1
```

## Scene → screenshot mapping

| Scene | Screenshot file |
|-------|-----------------|
| Reveal | `01-dashboard.png` |
| Import | `02-import-upload.png`, `03-matching-rules.png`, `04-review-diffs.png` |
| Enrich HERO | `05-enrich-progress.png`, `06-enrich-done.png` |
| Export | `07-export-dialog.png` |
| Sync | `08-sync-chat.png` |
| Scale | `09-products.png` |
| Teams | `10-team.png` |

## Guardrails

1. **Never** edit root `src/`, root `package.json`, or Next.js config for promo work
2. **Never** import Supabase, auth, or API routes into Remotion
3. Use **staged data** from `demo-products.json` or screenshots — not live API
4. Prefer **browser mockups** with screenshots over rebuilding full app UI
5. Enrich scene gets the **longest duration** (~8 seconds)
6. Apply brand from `brand.json` in every scene

## Output report format

When finishing a promo task, report:

1. Scenes implemented / remaining
2. Assets used vs missing
3. Preview/render commands run
4. QA frame checkpoints passed
5. Output path in `promo-video/out/`
