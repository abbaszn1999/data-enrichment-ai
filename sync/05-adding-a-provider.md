# Adding a store platform

The engine never imports a provider module — everything store-shaped goes through
`getProvider(...)`. So this is a matter of registering a platform, not of editing
the pipeline.

Work in `src/lib/sync/providers/<name>/` and add two things to the provider
object.

## 1. Detection

```ts
growthSync: {
  async detectNewProducts({ integration, taxonomyId, since, maxPages }) {
    return { products, newestCreatedAt, truncated };
  }
}
```

Three contracts to honour, each of which the engine depends on:

**`since === null` must return nothing, without calling the store.** A fresh rule
owns the future only. Walking the catalogue here would classify the entire back
catalogue on the first check.

**Filter on the product's own creation time**, not on when it was filed into the
category. An old product moved into a watched category today must not surface.

**Set `truncated` when you stopped before reaching `since`.** This is the one that
is easy to get wrong. It does not mean "there is more to come" — it means "the
oldest new products were never seen", which the engine treats as a condition it
cannot record honestly, and it refuses the run. If you ran out of pages *and*
reached the watermark, that is the successful case: leave `truncated` unset.

Return whatever fields you have. The classifier reads title, type, vendor, tags,
and the start of the description; anything missing simply narrows what it has to
go on.

## 2. Taxonomy

```ts
taxonomy: {
  list({ integration }),                             // the "what to watch" picker
  assign({ integration, taxonomyId, productIds }),   // required
  unassign({ integration, taxonomyId, productIds }),  // optional; enables Undo
}
```

`list` returns `TaxonomySummary[]`. The `manual` flag is the one to get right: it
tells the picker whether membership can be written at all. Shopify's automated
collections decide their own membership from rules on the store and reject an
`assign`, so they are listed but not selectable. WooCommerce has no such notion
and reports `manual: true` throughout. Getting this backwards produces rules that
look fine and fail on every run.

`unassign` is optional. Without it the Undo button simply does not appear, which
is better than a button that fails.

## 3. Vocabulary

Set `schema.taxonomyLabel` — "Collections", "Categories", whatever the platform
calls them. It travels with the API payload, so the UI never guesses and no
component learns which store is connected.

## 4. Tests

Mock the HTTP layer, not the engine. `growth-sync.test.ts` next to the Shopify
and WooCommerce implementations is the pattern: fake the client, then assert the
contract above — no watermark means no call, truncation is reported, the fields
the classifier reads are carried through, and a bad id fails loudly.

The engine's own tests run against a provider called `fakeshop` that does not
exist. If they still pass after your change, nothing in the pipeline has reached
into a specific platform.

## What you do not have to touch

The pipeline, the tables, the quota accounting, the UI. If a rule cannot be
created for your platform, the API says so up front by name — no silent failure
to chase.
