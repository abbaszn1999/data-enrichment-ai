# Architecture

## The path of one run

```
pg_cron (every 5 min)
   │
   └─► POST /api/growth-sync/tick          ← cron secret, not a user session
          │
          ├─ claimDueRules()               lease due rules, SKIP LOCKED
          └─ runRule() per rule
                │
                ├─ loadIntegration()             which store is connected
                ├─ detectAcrossWatched()         provider.growthSync.detectNewProducts
                ├─ planWork()                    oldest-first, capped, contiguous
                ├─ reserveClassifications()      allowance held before any AI call
                ├─ loadTargets()                 project categories that are live
                ├─ classifyProducts()            similarity → agent verdict
                ├─ applyDecisions()              provider.taxonomy.assign, one call per destination
                ├─ recordDecisions()             every decision, including refusals
                ├─ advanceWatermark()            only across what was handled
                ├─ releaseRule()                 clear lease, schedule next
                └─ refundClassifications()       for products the agent never read
```

## Files

```
src/lib/growth-sync/
  types.ts        Rules, decisions, outcomes. No provider anywhere in here.
  repo.ts         Every Supabase read and write the engine performs.
  engine.ts       The pipeline: detect → plan → reserve → classify → apply → record.
  classify.ts     Similarity retrieval and the agent call.
  quota.ts        Reserve and refund classification allowance.
  api-schema.ts   Zod schemas for the API bodies.
  client.ts       Browser-side calls into the API.

src/lib/growth-sync.ts
  Which projects are eligible to receive products. Reads Market Research state.

src/app/api/growth-sync/
  tick/           Called by pg_cron. Claims and runs due rules.
  run/            "Run now" from the dashboard.
  rules/          CRUD, plus the dashboard's combined read.
  taxonomies/     The store's real categories, for the picker.
  undo/           Take back an assignment.
  quota/          Read and activate a classification pack.

src/components/growth-sync/
  sync-dashboard.tsx          Rules and the activity feed.
  sync-usage-page.tsx         Consumption and the classification log.
  sync-subscription-page.tsx  Packs.

sync/                         These documents.
supabase/migrations/20260821_growth_sync.sql       Tables, RLS, functions.
supabase/migrations/20260821_growth_sync_cron.sql  The schedule.
```

`src/lib/growth-sync/**` never imports a provider module. Everything
store-shaped is reached through `getProvider(...)` from the sync registry. That
single constraint is what makes adding a store platform a matter of registering
it rather than editing the engine — and it is what lets the engine tests run
against a provider that does not exist.

## Tables

| Table | Holds |
| --- | --- |
| `gs_rules` | One rule: categories watched, project, cadence, lease, last error |
| `gs_watermarks` | Per rule and category, the newest product creation time already handled |
| `gs_runs` | One row per run, with counts and outcome |
| `gs_activity` | One row per product decision, with the reason and undo state |
| `gs_quotas` | The workspace's pack: included, used, period |

Every external identifier is a `*_ref TEXT` column. Shopify hands back
`gid://shopify/Product/1` and WooCommerce hands back `12345`, so no column is
shaped after either one.

`gs_quotas` is deliberately a counter and not the USD wallet. A pack is a monthly
allowance of classifications, so the accounting is a count, not a balance. Stripe
is not wired in yet: activating a pack from the Subscription page writes the
counter directly.

## Database functions

Each of these exists because doing the same thing from application code would
leave a race.

| Function | Why it is in SQL |
| --- | --- |
| `claim_gs_rules` | Selects due rules and leases them in one statement, `FOR UPDATE SKIP LOCKED`. A second tick walks past rows already taken instead of blocking |
| `lease_gs_rule` | The same guarantee for "Run now". Returns nothing when the lease is held, so two clicks cannot both enter |
| `release_gs_rule` | Clears the lease, records the outcome, schedules the next run. `p_due_now` keeps a rule due when a backlog remains |
| `defer_gs_rule` | Hands a lease back without consuming the rule's turn, for a tick that ran out of wall clock |
| `consume_gs_quota` | Reserves allowance under a row lock, refusing the whole amount rather than partially reserving |
| `release_gs_quota` | Refunds, floored at zero so a double refund cannot mint allowance |

All six are `SECURITY DEFINER` and granted to `service_role` only — revoked from
`anon` and `authenticated`. They are engine machinery, not an API.

## Row level security

Read policies on all five tables are scoped to workspace membership. Writes go
through the service role, from routes that have already checked membership.

`gs_watermarks` has no `workspace_id` of its own, so its policy inherits
membership from the owning rule. Without that, a member of one workspace could
read another's position by guessing a rule id.

## The provider contract

Two capabilities, both optional on the interface, both checked before a rule is
allowed to exist:

```ts
growthSync: {
  detectNewProducts({ integration, taxonomyId, since, maxPages })
}
taxonomy: {
  list({ integration })                             // the picker
  assign({ integration, taxonomyId, productIds })   // required
  unassign({ integration, taxonomyId, productIds }) // optional; enables Undo
}
```

`provider.schema.taxonomyLabel` is what the UI says instead of guessing:
Shopify reads "Collections", WooCommerce reads "Categories". It travels with the
API payload, so no component knows which store is connected.

If a provider omits `growthSync` or `taxonomy.assign`, rule creation refuses up
front with a message naming the platform, rather than accepting a rule that could
never run.
