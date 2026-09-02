# Autommerce Platform

A multi-workspace SaaS platform for e-commerce catalog teams. Upload worksheets, enrich product data with AI, generate and source imagery, classify photos, and sync changes back to connected storefronts — with credits, billing, and team roles built in.

---

## What you can do

### Dashboard
- Workspace overview: product and category counts, recent activity, and remaining credits at a glance.

### Products & Categories
- Maintain a master product catalog (upload Excel/CSV, search, bulk delete).
- Manage a category tree (create, edit, reorder, import/export) used by enrichment and matching.

### Import
End-to-end supplier import flow:

1. **New project** — upload Excel/CSV, set supplier and notes, optionally reuse saved enrichment presets.
2. **Matching rules** — map supplier columns to your catalog and decide new vs existing products.
3. **Review** — inspect match results before enrichment.
4. **Enrichment** — run AI column enrichment (OpenAI Standard/Premium) with concurrent workers, live row status, custom columns, and Excel export.

Typical enrichment outputs include SEO titles, marketing descriptions, feature bullets, category suggestions, keywords, marketplace-style copy, images, and source citations (configurable per project). Each selected product is enriched in a single OpenAI Responses call with hosted web search when needed.

### Media

**AI Classify**  
Upload product photos in bulk. AI groups and labels them (e.g. by SKU / product identity). Review results and export.

**Products Gallery**  
Project-based image pipeline from a product worksheet:

- **Scraping** — find real product images from the web with depth, source preference, resolution, and aspect filters.
- **AI generation** — create Main and Gallery shots with optional scene/model reference, branding (logo, colors, brand guide), and style controls.
- Worksheet preview, per-row retry, image lightbox, and export.

**Products Visualizer**  
Turn product rows into marketing-ready HTML descriptions with image placeholders, then generate those images. Supports branding assets, layout presets, review before image generation, and downloadable results.

### Sync
Chat-driven agent for connected storefronts (Shopify today; WooCommerce supported in the provider layer):

- Load and filter catalog products.
- AI column fills, image search, sheet edits, web research, and attachment analysis.
- Apply approved changes back to the store.
- Requires a workspace integration in Settings.

### Usage, Team, Settings & Subscription
- **Usage** — credit consumption history and breakdown.
- **Team** — invite members; roles (owner / admin / editor / viewer) gate sensitive actions.
- **Settings** — workspace profile, CMS type, and store integration credentials.
- **Subscription** — plans, credit packs, Stripe checkout/portal, and cancellation notices (owner/admin).

Credits power AI and media operations. The header balance updates after successful spend without a full page reload.

---

## Architecture (high level)

| Layer | Role |
|--------|------|
| **Next.js App Router** | UI + API routes (hosted on Render) |
| **Supabase** | Auth, Postgres, Storage (`workspace-files`), RLS |
| **Stripe** | Subscriptions, credit packs, webhooks |
| **AI + search APIs** | Enrichment, classify, gallery, visualizer, sync agents |

Heavy jobs (enrichment workers, gallery/visualizer runs, classify) run through app API routes with progress polling or background completion — not legacy edge-only hosting.

---

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS v4, shadcn/ui, Lucide Icons, next-themes
- **State**: Zustand, TanStack Query / Table / Virtual
- **Data**: Supabase (SSR + service role on server)
- **Files**: ExcelJS / SheetJS, JSZip, sharp
- **Billing**: Stripe
- **Tests**: Vitest
- **Hosting**: Render (Node)

---

## Getting started

### Prerequisites

- Node.js 22+ recommended (22 used in production)
- Accounts/keys for Supabase, Stripe, and the AI / web-search providers you enable

### Install

```bash
npm install
```

### Environment

Copy your secrets into a root `.env` (never commit real keys). Typical variables include:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (e.g. `http://localhost:4000`)
- AI provider API keys used by enrichment and media (`OPENAI_API_KEY` required for Import AI enrichment and Gallery scraping)
- Optional Gemini / Serper keys still used by Sync and some media paths
- `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`
- Stripe price IDs for plans and credit packs

Configure the same variables on Render for production, and point Stripe webhooks at `/api/webhooks/stripe`.

### Auth email via Resend (SMTP)

Team invites and magic links are sent by **Supabase Auth**. To deliver them from your domain through Resend, enable **custom SMTP** in the Supabase project (no app code change):

1. Verify `autommerce.com` in the [Resend domains](https://resend.com/domains) dashboard (DNS records must be green).
2. Open Supabase → **Authentication** → **Notifications / Email** → **SMTP Settings**  
   (or: [Auth SMTP for this project](https://supabase.com/dashboard/project/iqliulcthkzufmlekbrj/auth/smtp)).
3. Enable Custom SMTP and set:

| Field | Value |
|--------|--------|
| Sender email | `noreply@autommerce.com` |
| Sender name | `Autommerce Platform` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (`re_…`) |

4. Save, then send a test team invite. Check Resend → **Emails** for delivery.

Optional: connect Supabase from [Resend Integrations](https://resend.com/settings/integrations) to prefill the same settings.

`RESEND_API_KEY` / `RESEND_FROM_EMAIL` in the app `.env` are optional for this SMTP path (Supabase stores the SMTP password itself). Keep them if you later send mail from the Next.js API.

Also confirm Auth **Site URL** and **Redirect URLs** include your app origin (`http://localhost:4000` and the production URL).

### Run locally

```bash
npm run dev
```

App default: [http://localhost:4000](http://localhost:4000)

```bash
npm run build && npm start   # production-like
npm run lint
npm run typecheck
npm test
```

---

## Typical workflows

1. **Create / join a workspace** → subscribe (owner) → invite teammates.
2. **Upload categories** (optional) → **Import** a supplier sheet → match → enrich → export or push into master products.
3. **Media** — classify raw photos, build a Gallery project, or generate Visualizer descriptions/images.
4. **Connect the store** in Settings → use **Sync** to load products, edit with the agent, and apply changes.

---

## Project layout (useful paths)

```
src/app/(dashboard)/w/[workspaceSlug]/   # Workspace UI (import, media, sync, …)
src/app/api/                             # Server routes (enrich, gallery, visualizer, sync, stripe, …)
src/lib/gallery|visualizer|sync|…        # Domain logic & agents
src/components/                          # Shared UI
supabase/migrations/                     # Database migrations
```

---

## License

MIT
