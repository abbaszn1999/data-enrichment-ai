# Large stores: the limits and why

Every number here exists because a run has to finish inside one HTTP request. If
it does not, the process is killed mid-pipeline — and a run killed after the
allowance was reserved but before the refund is the one failure mode that costs
a customer money for nothing.

| Limit | Value | Why |
| --- | --- | --- |
| Products classified per run | 60 | Six agent calls at three at a time. Comfortably inside the request budget |
| Products per agent call | 10 | Fits in context with room for candidates, and one call per product would be needlessly slow |
| Agent calls in flight | 3 | Latency would otherwise dominate the budget. Low enough to stay clear of rate limits |
| Candidates per product | 12 | Not a business cap — the threshold decides relevance. A store with 800 categories would otherwise build a prompt no model can read carefully |
| Pages walked per category | 20 — 5,000 products on Shopify, 2,000 on WooCommerce | In the steady state the walk stops on the first page. The ceiling only stops a bulk import becoming an unbounded crawl |
| Rules per tick | 3 | Sequential, inside a 45-second budget |
| Lease | 10 minutes | Long enough to outlive any run, short enough that a hard crash frees the rule quickly |

## What happens when more than 60 products are new

Nothing is lost, and nothing is delayed by an interval.

The run takes the **oldest 60**, moves each watermark up to the last product it
handled, and reports how many are queued. Then it makes itself due again
immediately rather than waiting out its interval — a backlog worked at one
interval per 60 products would only get deeper.

So 500 new products with an hourly rule are cleared in about nine consecutive
runs over the following few minutes, not over nine hours.

The reason it takes the oldest rather than the newest is the shape of a
watermark. It is a single point in time, so it can only ever say "everything up
to here is handled". If the run took the newest 60 and moved the watermark to
them, the older ones underneath would be below the watermark — considered
handled, never looked at again. Taking the oldest keeps the handled set a
contiguous block starting exactly where the watermark is.

## What happens on a bulk import

If the walk through a category hits its page ceiling while still finding new
products, it means the **oldest** new products were never even seen. There is no
honest way to record that: the handled set is not contiguous, so no single
watermark describes it. Moving the watermark forward would silently drop
everything below; leaving it alone would repeat the same failed walk forever.

So the run refuses. Nothing is spent, no watermark moves, and the rule is paused
with a message naming the category and saying plainly that Sync follows a store
as it grows, and that a one-off import of thousands of products is better
classified from the Market Research project directly.

This needs thousands of products added to a single watched category within one
interval to trigger — 5,000 on Shopify, 2,000 on WooCommerce.

## Things that are already handled

**A product in two watched categories** is classified once, and both watermarks
move past it. If only one moved, the other would find it next run and pay again.

**A product with no usable creation date** is ignored rather than processed. It
cannot be placed against the watermark, so it would otherwise be reclassified on
every single run, forever.

**A category that refuses the write** — an automated Shopify collection, a
deleted category — fails on its own. The rest of the run's assignments stand, and
the failure is recorded against the products with the store's own message.

**Two runs at once** cannot happen. The scheduler and the "Run now" button take
the same lease, in the statement that hands the rule over.

**A tick that runs out of time** hands the leases back instead of holding them.
The rule stays due, so the next tick five minutes later takes it, rather than
waiting for a ten-minute lease to lapse.

## What is not covered yet

Worth knowing before promising any of it:

- **Review mode.** `gs_rules.mode` accepts `review`, but the engine treats every
  rule as `auto`. There is no queue of pending assignments waiting for approval.
- **Undo on WooCommerce vs Shopify.** Both are supported, but Shopify's removal
  is a queued job, so the UI says "removal queued" rather than claiming it is
  done. WooCommerce applies inline.
- **Billing.** Packs are counters. Activating one from the Subscription page
  writes the counter directly; Stripe is not connected.
- **Retention.** `gs_activity` and `gs_runs` grow without a pruning job. At a few
  hundred classifications a month this is years away from mattering, but it is
  not bounded.
- **Rate limits across many rules.** Each provider client throttles its own
  calls, but ten rules on the same store running in the same tick are not
  coordinated. With three rules per tick this has room, though it is not a
  guarantee.
