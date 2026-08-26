# How it works, step by step

## Step 1 — Creating a rule

A **rule** is one sentence: *"watch these categories, and file what shows up into
this project."*

On the dashboard you choose:

- **Which categories to watch.** These are real categories on the store, fetched
  live. On Shopify some collections decide their own membership from rules on the
  store side; those are listed but cannot be selected, because Shopify would
  refuse the write. On WooCommerce every category is hand-editable, so all of
  them are selectable.
- **Which project to file into.** Only projects that already have categories
  published to the store can be chosen. A category that was never pushed has no
  address on the store, so there is nowhere for a product to go.
- **How often to check.** Hourly, every 6 or 12 hours, daily, or manual only.

The rule remembers which store platform it was created against. If the workspace
later connects a different store, the rule stops with a clear message instead of
quietly writing products into categories nobody chose.

## Step 2 — The watermark

The moment the rule is created, Sync writes down the current time once per
watched category. That is the watermark.

Everything Sync does afterwards is relative to it: a product counts as new if it
was created **after** the watermark. This one line is what keeps a new rule off
the existing catalogue. Without it, the first check would treat every product in
the store as new and try to classify all of them.

Two details that surprise people:

- The watermark is compared against **the product's own creation date**, not the
  date it was filed into the category. An old product moved into a watched
  category today will not show up. That is the intended reading of "new
  product" — Sync is here for the store growing, not for reorganising.
- A product created at exactly the watermark counts as already handled. If it
  did not, the same product would be reclassified — and paid for — on every
  single run.

## Step 3 — Checking for new products

A scheduler inside the database wakes up every five minutes and asks the app:
*any rules due?* That five minutes is only a heartbeat; each rule's own schedule
decides whether it is actually due.

When a rule is due it is **leased** — locked for ten minutes — in the same
database statement that hands it over. Two overlapping checks therefore cannot
enter the same rule and classify the same products twice. Pressing "Run now"
takes the same lease, which is why a second click gets "This rule is already
running" rather than a duplicate run.

Then, per watched category, Sync asks the store for products created after the
watermark. The two platforms answer differently:

- **Shopify** cannot filter a collection's products by date, so Sync asks for
  them sorted newest-first and stops at the first product older than the
  watermark. In the normal case that is a single request, no matter how large
  the collection.
- **WooCommerce** filters by date server-side, so the request itself returns only
  new products.

Most runs end right here, with "nothing new". That is recorded too — "we checked
and there was nothing" is genuinely different from "we never ran".

## Step 4 — Deciding where each product belongs

This is two stages, and the split matters.

**Stage one: narrow the field.** Each product's text — title, type, vendor, tags,
the beginning of its description — is compared against each published category
in the project. Categories that score above a similarity threshold become
candidates. Everything below it is not talking about the same subject and is
dropped without ceremony. If a product has no candidate at all, it never reaches
the AI: there is nothing to ask, and "no category came close" is a useful thing
to record as-is.

Comparison uses embeddings when an OpenAI key is configured, and falls back to
word overlap when it is not. The fallback is weaker, but a degraded engine beats
a disabled one, and the agent still has the final say — a loose candidate costs a
rejection, not a bad write.

**Stage two: judge.** The candidates go to the agent in batches, with a prompt
that says plainly what the candidate list is: *the output of a similarity search,
so it contains near-misses on purpose — an accessory sitting next to the device
it fits, or a category that shares words but not meaning.* The agent answers
per product and per candidate: belongs, or does not, and why. A product may
belong in several categories, or in none.

Two guards sit around the answer:

- A verdict naming a category the search never offered is discarded. Writing to
  it would put the product somewhere nobody vetted.
- If the agent call itself fails — a rate limit, a timeout — the products in that
  batch are marked **failed**, not skipped. Failed means "still to be decided",
  so they are picked up again. Skipped would have buried them.

## Step 5 — Writing to the store, and recording

Accepted products are grouped by destination, so each category takes one request
rather than one per product.

If one destination refuses the write — an automated Shopify collection, a deleted
category — only that group is marked failed. The rest of the run's work stands.

Then every decision is written down: the product, where it went or why it did
not, the similarity score, and the agent's own words. This is what makes the
activity feed an audit trail rather than a list of things that happened. A
refusal with a reason is the whole point.

## Step 6 — Moving the watermark

The watermark moves **only after the decisions are stored**, and only across
products this run actually handled, stopping at the first one it did not.

The order is not interchangeable. A crash between the store write and the
watermark update means the products are detected again next run — the assignment
is repeated harmlessly. A crash the other way round would move the watermark past
products that were never decided on, and they would be gone.

A product found in two watched categories is classified once, and **both**
watermarks move past it. If only one moved, the other category would find the
same product next run and pay for it a second time.

## What the run costs

Allowance is reserved for every product before the agent is called, and the
unused part is refunded after. Products that never reached the agent — because
nothing came close — cost nothing.

If the allowance cannot cover the run, nothing is spent: the run stops before the
AI call and the rule is paused with an explanation, rather than burning a check
every hour on something that cannot proceed.

## When a rule stops

Sync distinguishes two kinds of failure, because they deserve opposite
treatment.

**Paused** — the rule cannot possibly succeed as configured. No store connected,
the store platform changed, the pack ran out, the project has nothing published,
a bulk import too large to work through. The reason appears on the rule card and
the rule stops consuming checks. Turning it back on clears the message.

**Retried** — something transient. The store returned a 503, the network
dropped. The rule keeps its schedule and tries again next time.
