# Setup

## Store permissions

**Shopify** — no scopes beyond what Sync Pro already needs. Collection membership
is covered by `read_products` / `write_products`.

**WooCommerce** — no extra permission. The existing Read/Write REST API key under
*WooCommerce → Settings → Advanced → REST API* is enough.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GROWTH_SYNC_CRON_SECRET` | Bearer token the tick endpoint requires. Must equal the `growth_sync_cron_secret` Vault secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Already required elsewhere. The engine writes past RLS with it |
| `GEMINI_API_KEY` | The classification agent. Required |
| `OPENAI_API_KEY` | Embeddings for the similarity stage. Optional — without it retrieval falls back to word overlap and the agent still decides |

## Order of operations

The order matters: the scheduler calls an endpoint, so the endpoint has to exist
and know the secret before the schedule starts firing.

1. **Apply the tables.**
   `supabase/migrations/20260821_growth_sync.sql`
2. **Set `GROWTH_SYNC_CRON_SECRET`** in the deployment environment and redeploy.
   Until then the endpoint answers 503, which is correct — an unconfigured
   scheduler should refuse rather than run unauthenticated.
3. **Apply the schedule.** Open
   `supabase/migrations/20260821_growth_sync_cron.sql`, set the deployed origin
   and the same secret at the top, then run it. Both values go into Supabase
   Vault rather than inline in the schedule body, because `cron.job` is readable
   by anyone who can read the catalog.

## Verifying

```sql
-- Is the schedule live?
SELECT jobname, schedule, active FROM cron.job;

-- Did the last few calls land? Anything other than 200 is worth reading.
SELECT status, created FROM net._http_response ORDER BY created DESC LIMIT 5;

-- What has the engine been doing?
SELECT started_at, status, detected_count, assigned_count, error
FROM gs_runs ORDER BY started_at DESC LIMIT 20;
```

A healthy idle system shows runs with status `skipped` and zero counts. That is
the engine checking and finding nothing, which is the common case by far.

## Notes on the scheduler

`pg_cron` evaluates schedules in UTC. The five-minute cadence is only a
heartbeat — each rule's own `next_run_at` decides when it actually runs, so there
is no per-interval schedule to maintain.

`pg_net` is fire-and-forget. It does not retry, does not alert on a non-2xx, and
only records the response in `net._http_response`. The tick endpoint is therefore
built to be **resumable** rather than to be retried: each call claims a few due
rules, works within a wall-clock budget, and leaves the rest due for the next
call.

## Changing a rule's cadence

Editing the interval reschedules from now, it does not backdate. Switching a rule
to "manual only" leaves it in place but never due; it runs only from the button.
