# Sync

Sync watches categories on the store and files **newly created products** into
the categories a Market Research project has already published.

It only ever looks forward. A rule created today is responsible for products
created after today, never for the catalogue that already exists.

## The whole thing in one page

1. You pick some store categories to **watch**, and one Market Research project
   to file into.
2. Sync writes down the current time for each watched category. This is the
   **watermark**: "everything up to here is already handled".
3. On a schedule, Sync asks the store: *any products created after the
   watermark?* Usually the answer is no, and the run ends there.
4. When there are new products, each one is compared against the project's
   published categories. The close ones go to an AI agent, which decides which
   category — if any — the product genuinely belongs in.
5. Accepted products are added to their category on the store. Every decision is
   written down, including the refusals and why.
6. The watermark moves up to the last product handled, and the next run starts
   from there.

## The documents

| File | What it covers |
| --- | --- |
| [`01-how-it-works.md`](01-how-it-works.md) | The six steps above, one by one, in detail |
| [`02-architecture.md`](02-architecture.md) | Files, tables, and the provider contract |
| [`03-setup.md`](03-setup.md) | Environment variables, migrations, verification |
| [`04-large-stores.md`](04-large-stores.md) | The limits, why each exists, and what happens at the edges |
| [`05-adding-a-provider.md`](05-adding-a-provider.md) | Supporting a new store platform |

## Three ideas worth holding on to

Everything else follows from these.

**The watermark is a single point in time, so work must be contiguous.** Sync
processes new products **oldest first**. If it stopped halfway through and moved
the watermark to the newest product it happened to look at, everything below
would be stepped over and lost forever. Taking the oldest first means the block
processed always starts exactly where the watermark is, so the watermark can
follow it without a gap.

**Similarity finds candidates; the agent decides.** A high similarity score
between "USB-C Cable" and "USB-C Chargers" is precisely the near-miss that needs
judgement. So the score never decides anything on its own — it only chooses what
the agent is asked about. And if the agent names a category the search never
offered, that verdict is thrown away rather than written to the store.

**Nothing is spent on work that was not done.** Allowance is reserved before the
AI is called and the unused part is handed back after. A run that finds 20
products but only puts 3 to the agent is billed for 3.
