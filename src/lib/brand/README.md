# Autommerce product brand system

This directory is the source of truth for the gradual product rebrand.

## Identity

- Brand promise: **Empowering E-commerce with AI Excellence**
- Vision: lead innovative, reliable AI solutions for e-commerce.
- Mission: AI-driven SEO, SEM, commerce solutions and development with measurable results.

## Colour

Primary:

- Orange `#F76D01` — energy, action, creation
- Red `#C40000` — impact and decisive states
- Purple `#400095` — intelligence and orchestration

Secondary:

- Violet `#6B358D`
- Lavender `#C8A8D2`
- Burgundy `#79081D`

The signature gradient runs orange → red → purple. Status colours (success,
warning, destructive) remain semantic and must not be replaced by brand colours
when doing so would reduce clarity.

## Typography

The official family is **Uni Neue** by Fontfabric. Embedding it in this web app
requires a webfont license and licensed WOFF2 files. Until those files are
provided, `--brand-font` falls back to Geist; do not download or commit an
unlicensed copy.

When licensed files are added, place them in `public/fonts/uni-neue/` and define
the supplied weights with `@font-face` in `src/app/globals.css`. No component
changes will be needed.

## Logos

- Light surfaces: `/autommerce-natural.png`
- Dark surfaces: `/autommerce-white.png`
- React component: `src/components/brand/autommerce-logo.tsx`

Never recolour, stretch, crop, rotate, or add effects to the logo itself.

## Migration rule

Migrate one product surface at a time. Raw values live in `tokens.ts`; shared
components live under `src/components/brand/`. Do not duplicate hex codes in
new tool-specific styles. The Dashboard is the first migrated surface.

