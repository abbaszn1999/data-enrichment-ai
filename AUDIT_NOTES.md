# Autommerce — Enterprise Production Readiness Audit & Remediation Plan

> **Audit Persona:** Large enterprise merchant — 10,000 to 100,000+ SKUs, 30+ columns, high-frequency catalog updates, multi-department team of 20–100 seats, live storefront receiving 100,000+ shopper pageviews/day.
>
> **Audit Scope:** 17 product modules + platform-level concerns (auth, tenant isolation, plan enforcement, observability, disaster recovery).
>
> **Method:** Direct source inspection with file/line evidence. Every claim in this document is either marked `✅ VERIFIED IN CODE` (read and confirmed) or `⚠️ ASSUMED` (inferred, needs confirmation). Industry practices are cited as the *reason* for each recommendation, not as decoration.

---

## 📖 How To Read This Document

| Field | Meaning |
| :--- | :--- |
| **Priority** | `P0` = blocks first enterprise customer. `P1` = fix within first month of go-live. `P2` = fix within first quarter. `P3` = quality-of-life. |
| **Effort** | `S` = under a day. `M` = 1–4 days. `L` = 1–3 weeks. `XL` = architectural, over 3 weeks. |
| **Blast Radius** | What actually breaks: `Data Loss`, `Security`, `Cost`, `Availability`, `UX`, `Compliance`. |
| **Status** | `❌ Open` / `🟡 Partial` / `✅ Done`. Update this column as work lands. |

**Priority is not the same as severity.** A slow page is severe but survivable; a silent lost write is a smaller code bug but destroys customer trust permanently. This plan is ordered by *business consequence*, not by CPU cycles.

---

## 🧭 Resolved Decisions (open questions closed, with the reasoning)

Three items were left open in earlier revisions. All three are now decided against researched 2026 practice so no one has to re-litigate them mid-implementation.

### Decision 1 — Route shape: drop the `/enrich` leaf
**Resolved:** `/w/{slug}/catalog-intelligence/{sessionId}` — **no trailing `/enrich`.**

**Why.** Three independent conventions all point the same way:
1. **No verbs in paths.** `enrich` is a verb; the URL should name the *resource* (a catalog session) and let the interaction express the action. Verb-in-path is the most consistently cited naming anti-pattern.
2. **Nesting depth: one level, two at most.** `/{slug}/catalog-intelligence/{id}/enrich` is three segments deep past the workspace. The published rule of thumb is that two levels is a smell and three is almost always wrong.
3. **A globally unique child is promoted to top level.** `sessionId` is a UUID — it identifies the session with no help from an ancestor. When a sub-resource has its own globally unique id, it should be addressed directly rather than reached through a parent chain.

There is also a product-specific reason: `/enrich` was one of *several* sibling views (`review`, `rules`, `enrich`) and is now the only surviving one, so the segment carries **zero disambiguating information**. A path segment that never varies is pure noise.

**Consequence for the migration:** the `permanent: false` (307) redirect must therefore cover the deeper old shape too — `/w/:slug/import/:id/(enrich|review|rules)` → `/w/:slug/catalog-intelligence/:id`.

---

### Decision 2 — The unaudited gaps: audit two now, defer the rest with named triggers
**Resolved:** do not treat "not yet audited" as one undifferentiated backlog. Two of the eight are **P1 and pulled into the plan now**; the other six get an explicit trigger condition so they are deferred deliberately rather than forgotten.

**Why split rather than either audit everything or nothing:** an audit list without priorities becomes a source of anxiety instead of action (this is the same failure the priority system in this document exists to fix). The two promoted items share one property that the other six lack: **they are cheapest to fix before real data exists, and both are contractual questions an enterprise buyer will ask in writing.**

| # | Gap | Decision | Trigger / rationale |
| :--- | :--- | :--- | :--- |
| 1 | **Tenant deletion & GDPR erasure** | **Audit now** → became Finding S-5 below | Article 17 is a written contractual answer, and the correctness bug found is a permanent-orphan risk |
| 2 | **Per-policy RLS correctness** | **Audit now** → `P1`, see Finding S-6 | RLS is the last line of defence behind 42 service-role routes; "enabled" ≠ "correct" |
| 3 | Load / soak testing | Defer → **Decision 3** below | Replaced by measurement-first instrumentation, which is cheaper and continuous |
| 4 | Email deliverability (SPF/DKIM/bounces) | Defer | Trigger: **before the first external invitation is sent to a customer's domain.** Until then only your own addresses are affected |
| 5 | Stripe edge cases (dunning, proration, refunds, downgrade credits) | Defer | Trigger: **before the first real subscription.** Cannot be meaningfully tested without live billing history |
| 6 | Onboarding / first-run flow | Defer | Trigger: **before the first customer self-serves.** Currently exercised manually by the owner, so failures surface immediately |
| 7 | Accessibility (keyboard, focus, screen readers) | Defer | Trigger: **on the first enterprise procurement or VPAT request.** Genuine requirement, but demand-driven |
| 8 | Mobile / small-viewport data grids | Defer | Trigger: on evidence of real mobile usage. Dense catalog editing is a desktop workflow; optimising speculatively is waste |

**Why trigger conditions instead of dates:** every one of these six becomes necessary at a *known event*, not at a known time. Tying the work to the event is both honest and self-enforcing — you cannot pass the trigger without noticing.

---

### Decision 3 — Numbers: instrument first, do not load-test yet
**Resolved:** every figure in this document stays labelled analytical. Do **not** build a load-testing harness now. Instead, make the four numbers that drive `P0` decisions **observable in production** as part of P0-9, then confirm them from real traffic.

**Why this is the right call and not laziness:**
- **A load test measures a system you have decided not to keep.** Root Cause A will change the I/O profile of `/products`, enrichment, gallery and the wallet ledger. Benchmarking the blob architecture produces numbers with a known expiry date.
- **The `P0` decisions do not depend on precision.** Issue 3.1 is a blocker whether the true figure is 150 GB or 400 GB per run; both exceed a 250 GB monthly quota. Refining the estimate would not change a single priority in the matrix, so the measurement has no decision value — which is the test for whether a measurement is worth its cost.
- **Instrumentation is strictly better than a benchmark.** A load test is one number from synthetic traffic on one day. Telemetry is a continuous number from real traffic that also catches regressions. Since P0-9 (Sentry) is already a blocker being installed in Week 1, the marginal cost of adding these four counters is close to zero.

**The four numbers to instrument in Week 1, and why each:**
1. **Storage bytes written per job run** (tag: `job_run_id`, `kind`) — directly validates or refutes Issue 3.1/5.2/6.2 and is the single figure that protects the egress quota.
2. **`/api/embed/content` p95 latency and requests/minute** — this endpoint sits in a customer's revenue path (Issue 8.1); it is the only metric here where the pain is felt by someone who is not your user.
3. **Response payload size for the gallery poll and `/api/wallet`** — turns Issues 5.1 and 10.1 from arithmetic into observed fact, and both are trivially instrumented at the response boundary.
4. **Peak Node.js heap per worker** (tag: `kind`) — the OOM risk in Issues 4.2 and 6.3 is invisible until it is fatal; a high-water-mark gauge makes it visible while it is still cheap.

**Escalation path (so this decision has an end):** run a real load test **after** the Root Cause A migration and **before** the first enterprise onboarding — at that point the architecture is stable and the test measures the system you are actually shipping.

---

## 🎯 Executive Summary — The Verdict

**The financial and job-orchestration layers of this platform are genuinely strong.** Pessimistic row locking (`FOR UPDATE`), cryptographic idempotency keys, `NUMERIC(12,4)` micro-billing, hold-and-settle wallet semantics, monotonic revision claiming, and job heartbeat/resume are all implemented correctly and are better than many funded SaaS products. Row Level Security is enabled across 30+ tables. Stripe webhooks verify signatures. Platform-admin routes are uniformly guarded.

**Three systemic problems stand between the current state and an enterprise customer:**

1. **JSON-blob-as-database.** Row data lives in large JSON files in object storage instead of Postgres tables. This single decision is the root cause of *at least 8* separately-documented issues and is the dominant driver of both cost and latency at scale.
2. **A public, unauthenticated endpoint that over-fetches every tenant's credentials and matches tenants by substring.** This is the only finding in this document I would classify as an active security incident risk.
3. **Commercial guardrails are specified but not enforced.** `checkLimit()` and `canPerformAction()` exist in `src/lib/subscriptions.ts` and are **never called anywhere in the application**. Nothing stops a Starter-plan customer from uploading 500,000 products.

**Bottom line:** the platform is roughly **4–6 weeks of focused work** away from being safe to sell to a large merchant. The P0 list below is that work.

---

## 🔬 Root Cause Analysis — Why The Same Bug Keeps Reappearing

Before the per-module detail, understand the three roots. Fixing a root eliminates many symptoms at once; fixing symptoms individually is slower and leaves the next symptom to be discovered by the customer.

### Root Cause A — "JSON Blob As Database" (drives ~40% of all findings)

**What it is:** Catalog rows, enrichment rows, gallery worksheets, visualizer worksheets and market-research slices are persisted as whole-file JSON documents in Supabase Storage (`products.json`, `project.json`, `worksheet.json`) rather than as rows in Postgres.

**Why this pattern was chosen (and why it was reasonable early):** it's schema-free, it ships fast, and it avoids migrations while the data shape is still changing. For a prototype with 200 products this is the correct engineering trade-off.

**Why it collapses at enterprise scale — the technical mechanism:** object storage has no partial update primitive. There is no `UPDATE ... WHERE id = ?` for a blob. To change one cell you must (1) download the entire document, (2) parse it, (3) mutate it in memory, (4) re-serialize it, (5) re-upload it in full. Cost is therefore \(O(\text{total dataset size})\) per single-cell write, when it should be \(O(1)\). It also provides no concurrency primitive, so two writers always produce a lost update, and no query primitive, so all filtering, searching, sorting and aggregation must happen in the client after a full download.

**Symptoms it produces:** Issues 1.1, 1.2, 1.3, 1.4, 3.1, 3.5, 5.1, 5.2, 6.2, 10.1, 13.1.

**The real fix (`XL`, but do it incrementally):** move row data into Postgres tables — `products(workspace_id, sku, data jsonb, updated_at)`, `import_rows`, `gallery_rows`, `visualizer_rows` — with indexes on `(workspace_id, sku)` and a GIN index on `data` for search. Keep JSONB for the flexible column bag so no schema rigidity is introduced. Object storage then holds only what it is good at: images and export artifacts.

**Why this is the right call and not over-engineering:** the moment rows are in Postgres, server-side pagination, full-text search, `SUM()` aggregates, `SELECT FOR UPDATE` concurrency and per-row updates all become one-line queries. Eight documented issues disappear as a side effect rather than requiring eight separate mitigations. Every mitigation listed under those issues (chunked checkpointing, optimistic version tags, lazy signing, client debouncing) is a workaround for a constraint you can simply delete.

**Migration sequencing that avoids a big-bang rewrite:**
1. Create the tables and dual-write (blob + table) behind a feature flag.
2. Backfill existing blobs with a one-off script.
3. Flip reads to the table module by module, starting with `/products` (highest pain, simplest shape).
4. Drop blob writes once every reader is migrated.

### Root Cause B — "Write Amplification In Background Workers"

**What it is:** workers persist full state after every row transition instead of at checkpoints.

**Why it matters as its own root:** even after Root Cause A is fixed, the *habit* of "persist everything on every event" will reappear in the next feature. The correct discipline is a two-tier persistence model: **hot state** (progress counters, current row, heartbeat) goes to a cheap, frequently-writable store — a Postgres row — while **cold state** (the full artifact) is persisted at explicit checkpoints and on terminal transitions. This is standard practice in job frameworks (Temporal, Sidekiq, BullMQ) and is why they separate "job progress" from "job result".

**Symptoms:** Issues 3.1, 5.2, 6.2.

### Root Cause C — "Specified But Not Enforced"

**What it is:** guardrails documented as policy but absent from the execution path. Verified examples: plan limits (dead code), upload size limits (missing on 3 of 6 upload flows), and audit logging (absent).

**Why it matters:** an unenforced limit is worse than no limit, because the team believes protection exists and stops thinking about it. Every limit in this document now carries an explicit `Status` column for exactly this reason.

---

## 🏗️ Infrastructure Reality Check

> **Current:** Render Free + Supabase Free. **Target on first paid customer:** Render Standard + Supabase Pro.

| Layer | Free Tier Constraint | Paid Tier | Does Code Still Need Fixing? |
| :--- | :--- | :--- | :--- |
| **Render Web Service** | 512MB RAM, sleeps after 15min idle (~50s cold start), shared CPU | Always-on, 2–4GB+ RAM, dedicated CPU, background workers | **YES.** RAM ceilings scale linearly; a job that holds 200 Base64 images in heap (Issue 4.2) will OOM at 512MB and merely *survive* at 4GB while still being wrong. |
| **Supabase Storage** | 1GB storage, ~2GB/mo egress | 100GB storage, 250GB/mo egress | **YES — CRITICAL.** Issue 3.1 alone projects 150–400GB of egress *per enterprise enrichment run*. A paid quota does not survive this; it is an architectural defect, not a capacity problem. |
| **Supabase Postgres** | Auto-pauses when idle, small direct connection pool | No pausing, pgBouncer pooling, daily PITR backups | **YES.** Connection exhaustion under concurrent workers is a code/pooling concern, not a tier concern. |
| **Supabase Storage Backups** | Not covered by DB backup | **Still not covered by DB backup** | **YES.** See Issue P0-6: your customers' actual data lives in Storage and is currently unprotected on *both* tiers. |
| **Browser / Client** | Unaffected by server tier | Unaffected by server tier | **YES.** Issues 1.1, 1.2, 2.1, 12.1 execute on the merchant's laptop. No amount of server spend fixes them. |

### 🧪 Environment Topology & Data Disposability Window

> **Current state (confirmed by product owner, Sep 2026):** two independent Supabase projects — **`local`** (development) and **`deploy`** (production-candidate). **There is no real paying customer yet. All data in both databases is test data and is fully disposable.**

**Why this is recorded in an audit document rather than treated as a passing detail:** it is a **time-limited engineering asset that expires the moment the first customer signs**, and it directly changes the correct fix strategy for several findings in this plan.

| Constraint | While data is disposable (now) | After the first real customer |
| :--- | :--- | :--- |
| **Breaking schema changes** | `DROP TABLE` / `RENAME` / recreate freely; no backfill needed | Requires dual-write, backfill, and a reversible migration path |
| **Enum / CHECK constraint changes** | Rewrite the constraint and delete non-conforming rows | Must map every historical value; cannot delete ledger rows |
| **Credit & wallet ledger** | Truncatable — history has no financial meaning | **Immutable.** Financial records cannot be rewritten or deleted, ever |
| **Storage objects** | Bucket can be emptied and re-seeded | Requires backup, verified restore, and retention policy (see P0-6) |
| **Cost of getting a name wrong** | One migration | Permanent — a wrong identifier survives in ledgers and audit logs for years |

**The two operational rules that follow from this, and why:**

1. **Do all destructive/structural work now, in both databases simultaneously.** Specifically: Root Cause A's table migration, the identity consolidation in Section 18, the credit-operation renames in Section 19, and the credential encryption in P0-7. Each of these is *cheap today and expensive forever after*. Encrypting credentials later means decrypt-re-encrypt on live data; renaming an operation later means either a lossy `UPDATE` on a financial ledger or a permanent dual-vocabulary in reporting. Doing them now costs a migration and a re-seed.
2. **Keep the two databases schema-identical, and treat `deploy` as production from today.** The risk of a disposable-data window is drift: fixes get applied to `local`, `deploy` diverges, and the first customer lands on an unmigrated schema. Every migration in this plan must be applied to **both** projects in the same change, and `supabase/migrations/**` must remain the single source of truth — no manual SQL applied to one project only. **Why enforce production discipline before there is production traffic:** the transition to a real customer is not a scheduled event you can prepare for; it is a signature. The schema must already be correct when it happens.

**Explicit exclusion:** data disposability does **not** justify deferring P0-6 (Storage backup) or P0-9 (error tracking). Both are infrastructure that must exist *before* real data arrives, not after — a backup strategy invented under pressure after the first loss is not a strategy.

---

### Verified Request Timeout Ceilings

Prior drafts of this document quoted "60s serverless timeout" — that number comes from Vercel and **does not apply to this deployment**. Corrected, so nobody designs against the wrong number:

| Platform | Actual HTTP Request Limit |
| :--- | :--- |
| **Render Web Service (current host)** | No hard per-request timeout. Render terminates on ~100s of *no response bytes at all*. Streaming a response keeps a request alive far longer. |
| **Cloudflare proxy (if in front)** | 100s default (error 524). Applies only if traffic is proxied. |
| **Next.js `maxDuration`** | Application-level self-imposed cap. Repo currently mixes `60` (`jobs/sweep`) and `300` (`sync/agent`). |
| **Vercel** | 60s Hobby / 300s Pro — **not applicable here.** |

**Design conclusion:** on Render, long jobs are viable if they stream progress bytes. But *relying* on that is fragile — a client disconnect still kills the work. Streaming buys time; checkpointing buys correctness. Do both.

---

## 🚨 P0 — Release Blockers (do not onboard a large customer until these are closed)

| # | Finding | Module | Blast Radius | Effort | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-1** | Public embed endpoint fetches every tenant's plaintext store credentials | 8 | Security | S | ✅ Done |
| **P0-2** | Public embed endpoint matches tenants by substring → cross-tenant content leak | 8 | Security | S | ✅ Done |
| **P0-3** | Enrichment worker re-uploads full `project.json` after every row (150–400GB egress/run) | 3 | Cost / Availability | M | ✅ Done |
| **P0-4** | Master catalog apply has no concurrency control → silent lost updates | 3 | Data Loss | M | ✅ Done |
| **P0-5** | Plan limits are dead code — no upload or resource limit is enforced anywhere | Platform | Cost / Commercial | M | ✅ Done |
| **P0-6** | Supabase Storage (where all customer data lives) has no backup strategy | Platform | Data Loss | S | 🟡 Partial |
| **P0-7** | Store API tokens stored as plaintext JSONB | 15 | Security / Compliance | M | ✅ Done |
| **P0-8** | Gallery polling signs every image URL every 750ms (~2.5 MB/s per open tab) | 5 | Cost / Availability | M | ✅ Done |
| **P0-9** | Zero error tracking — no Sentry, no alerting, no visibility into production failures | Platform | Availability | S | 🟡 Partial |
| **P0-10** | Retired Render origin hardcoded in the storefront widget and in a `pg_cron` migration | 18 | Availability | S | ✅ Done |

---

## 🔐 Section 0 — Platform Security, Tenant Isolation & Governance

*This section did not exist in earlier drafts. It is the highest-consequence area in the document.*

### 📌 Inspection Scope
- `src/middleware.ts`, `src/lib/supabase-middleware.ts`
- `src/lib/workspace-context.ts`, `src/lib/permissions.ts`
- `src/lib/platform-admin/server-auth.ts` and all `src/app/api/platform-admin/**`
- All 42 API route files that instantiate `createAdminClient()` (service-role, RLS-bypassing)
- `supabase/migrations/**` RLS policy coverage
- `package.json` dependency posture

### 🌟 Verified Strengths — Genuinely Correct Security Work

1. **Broad Row Level Security coverage.** `✅ VERIFIED IN CODE` — RLS is `ENABLE`d across 30+ tables including `workspaces`, `workspace_members`, `workspace_integrations`, `import_sessions`, `job_runs`, `notifications`, `credit_transactions`, `wallet_transactions`, `workspace_wallets`, `mr_projects`, `gs_*`, `wr_projects`, `gallery_sessions`, `visualizer_sessions`, `profiles`. **Why this matters:** RLS is defence-in-depth. Even if an API route forgets a membership check, a request made with the anon key cannot cross tenant boundaries at the database level. Most startups skip this; you did not.
2. **Uniformly guarded platform-admin surface.** `✅ VERIFIED IN CODE` — every route under `src/app/api/platform-admin/**` (including the extremely sensitive `users/[id]/impersonate`) opens with `const denied = await requirePlatformAdmin();`. **Why this matters:** impersonation endpoints are the classic privilege-escalation hole in multi-tenant SaaS. A single unguarded one is a total compromise. All are guarded.
3. **Stripe webhook signature verification.** `✅ VERIFIED IN CODE` — `constructEvent` with `stripe-signature` in `src/app/api/webhooks/stripe/route.ts`. **Why this matters:** without it, anyone who learns the URL can POST a forged `checkout.session.completed` and grant themselves unlimited credits. This is the single most commonly exploited SaaS billing bug and it is correctly closed.
4. **Cron endpoints require a bearer secret and fail closed.** `✅ VERIFIED IN CODE` — `src/app/api/jobs/sweep/route.ts` returns `503 "Scheduler not configured"` when no secret is set, rather than running unauthenticated. **Why this matters:** failing *closed* on missing configuration is the correct default; many implementations accidentally fail open in staging and ship that behaviour to production.
5. **Centralised per-feature auth helpers.** `✅ VERIFIED IN CODE` — e.g. `requireGalleryAuth({ workspaceId, requireWrite: true })` returns `{ ok, admin, headers, response }`, so the service-role client is only reachable *after* membership and write-permission are established. **Why this matters:** this is the right structural answer to service-role risk — make the privileged client unobtainable without passing the gate, instead of relying on every developer remembering to check.

---

### ⚠️ Finding P0-1 — Public Endpoint Loads Every Tenant's Plaintext Credentials

* **Priority:** `P0` · **Effort:** `S` · **Blast Radius:** Security · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/app/api/embed/content/route.ts:69`

```69:70:src/app/api/embed/content/route.ts
    const { data: integrations, error: integErr } = await admin
      .from("workspace_integrations")
      .select("workspace_id, provider, base_url, config");
```

* **What is technically wrong:** this query has no `.eq()`, no `.filter()`, and no `.limit()`. It is a full table scan of `workspace_integrations` that materialises **every row for every customer** — including the `config` column, which per Finding P0-7 contains Shopify `shpat_` admin tokens and WordPress application passwords in plaintext. It executes on an endpoint that has **no authentication at all** (by design — it serves storefront widgets to anonymous shoppers) and which the middleware explicitly skips (`isApiRoute` short-circuits `updateSession`).
* **Why this is a P0 and not a performance note:**
  - **Credential blast radius.** Every anonymous shopper pageview pulls all tenants' live store admin credentials into the Node.js heap of a shared web process. Any future bug that echoes an object, any verbose error handler, any heap snapshot, any logging middleware, becomes a full multi-tenant credential disclosure. Security engineering calls this an unnecessary *credential reachability* expansion: the data has no business being in that process at all.
  - **It also scales catastrophically.** At 100,000 shopper pageviews/day this is 100,000 full table scans/day. Cost and latency are real, but they are the *lesser* problem.
* **Fix (the "why" for each part):**
  1. **Query by domain, not by scan.** Add a normalised, indexed column — `store_domain text GENERATED ALWAYS AS (...) STORED` or a maintained `normalized_domain` — with a unique index, then `.eq("normalized_domain", cleanDomain).maybeSingle()`. Turns an \(O(\text{tenants})\) scan into an \(O(\log n)\) index seek.
  2. **Never select `config` here.** Project only `workspace_id`. Principle of least privilege applied to *columns*, not just to routes. This endpoint has zero legitimate need for credentials.
  3. **Move the whole lookup out of the request path.** See Finding 8.1 — a flat `store_domain:handle → payload` cache table means the public endpoint touches exactly one indexed row and never reads `workspace_integrations` at all.

---

### ⚠️ Finding P0-2 — Substring Domain Matching Enables Cross-Tenant Content Leak

* **Priority:** `P0` · **Effort:** `S` · **Blast Radius:** Security · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/app/api/embed/content/route.ts:103-107`

```103:107:src/app/api/embed/content/route.ts
          const candidates = [baseDomain, cfgStoreDomain].filter((c) => c && c.length >= 4);
          if (
            cleanDomain.length >= 4 &&
            candidates.some((c) => c.includes(cleanDomain) || cleanDomain.includes(c))
          ) {
```

* **What is technically wrong:** "Pass 2" performs **bidirectional substring matching** on tenant identifiers with a minimum length of only 4 characters. Domain identity is being decided by `String.includes`, which is not an identity relation — it is neither symmetric in meaning nor transitive in a safe way.
* **Why this is exploitable, concretely:**
  - Tenant A owns `shop.com`. Tenant B owns `myshop.com.au`. `"myshop.com.au".includes("shop.com")` is `true`, so a request for one silently resolves to the other's workspace.
  - The `domain` value is an **attacker-controlled query parameter** on an unauthenticated endpoint. Anyone can enumerate short strings (`?domain=shop`) and harvest other merchants' generated SEO titles, descriptions, FAQs and internal link strategy — the actual commercial output your customers pay for.
  - Whichever tenant happens to be first in the unordered result set wins, so the leak is also **non-deterministic** — the worst possible property for a bug, because it is nearly impossible to reproduce from a support ticket.
* **Why the industry rule is absolute here:** tenant resolution must be an **exact match on a canonical key**. Fuzzy matching is acceptable for search ranking and unacceptable for authorization. Any comparison that can return true for two different tenants is an authorization bypass, regardless of how unlikely the collision seems.
* **Fix:**
  1. **Delete Pass 2 entirely.** Do not "tighten" the heuristic — tightening a fuzzy authorization check leaves a smaller hole, not zero hole.
  2. **Canonicalise both sides once** (lowercase, strip scheme/port/path, strip a single leading `www.`) and compare with `===`.
  3. **Support legitimate multi-domain tenants explicitly** via a `workspace_domains` table with one verified row per domain — that is the standard model (Shopify itself distinguishes `myshopify.com` from custom domains this way) and it removes any temptation to guess.
  4. **Add a regression test** asserting `shop.com` never resolves to the workspace that owns `myshop.com.au`.

---

### ⚠️ Finding P0-5 — Plan Limits Are Dead Code

* **Priority:** `P0` · **Effort:** `M` · **Blast Radius:** Cost / Commercial · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `assertProductQuota` / `assertImportQuota` / `assertJobRowQuota` at products import, Catalog Intelligence sessions/apply, gallery session create, and visualizer session create. Returns `402 { code: "plan_limit_exceeded", ... }`. `checkLimit` in `subscriptions.ts` is unused leftover; the live path is `src/lib/plan-limits.ts`.
* **What this means in practice:** the plan tiers on the pricing page (`maxProducts`, `maxImports`, `maxMembers`) are advertised but unenforced for products and imports. `max_members_per_workspace` *is* enforced independently inside `/api/team/invite`, so seats are safe — products and imports are not.
* **Why this is a P0 rather than a billing nicety:**
  - **Direct margin loss.** A Starter customer paying \$800/mo can upload 500,000 products and consume Pro-tier compute, storage and egress. Your unit economics assume a ceiling that does not exist.
  - **It converts a soft limit into a hard outage.** With no quota check, the first thing that stops the customer is not a friendly "upgrade your plan" dialog — it is an OOM, a storage quota error, or a frozen browser tab. Quota enforcement is a *reliability* mechanism as much as a billing one; this is why every mature platform (Stripe, Shopify, Vercel) enforces at the API boundary and returns `402/429` with a machine-readable reason.
  - **It compounds every other issue in this document.** Every scaling problem here is sized by "how much data can one workspace hold?" Right now the answer is unbounded.
* **Fix:**
  1. **Enforce server-side, at the mutation boundary** — inside `/api/products/*`, `/api/import/*`, `/api/gallery/sessions`, `/api/visualizer/sessions`. Client-side checks are UX affordances, never controls; anyone can call the API directly.
  2. **Return a structured error**, e.g. `402 { code: "plan_limit_exceeded", resource: "products", current, limit, upgradeUrl }`, so the UI can render a real upgrade path instead of a generic toast.
  3. **Check before work, not after.** Validate the projected total (`current + incoming`) *before* parsing the file or dispatching the job, so a rejected upload costs nothing.
  4. **Add a soft-warning threshold at 80%** so enterprise customers can plan an upgrade rather than hitting a wall mid-quarter.

---

### ⚠️ Finding P0-6 — No Backup Strategy For Supabase Storage

* **Priority:** `P0` · **Effort:** `S` · **Blast Radius:** Data Loss · **Status:** 🟡 Partial
* **Evidence:** `⚠️ ASSUMED` — no independent Storage backup job or restore drill in the repo. Weeks 5–8 dual-write products, catalog sessions, gallery rows, and visualizer rows into Postgres (PITR). Blobs still exist and are not versioned. Production Storage backup remains an ops task.
* **Why this is the most under-rated risk in the entire document:** because of Root Cause A, **the customer's actual product data does not live in Postgres — it lives in Storage** (`products.json`, `project.json`, `worksheet.json`). Supabase Pro's daily backups and PITR protect the database. They do **not** protect the Storage bucket. So today, a bad deploy, an errant delete loop, or a mistaken `remove()` on a prefix is **permanent and unrecoverable**, and the paid tier does not change that.
* **Compounding factor:** several documented issues (1.4, 3.1, 5.2) work by *overwriting the entire file*. A partial or corrupt full-file write does not damage one row — it destroys the whole dataset, with no prior version to fall back to.
* **Fix:**
  1. **Enable bucket versioning or a daily `rclone`/S3-compatible sync** to an independent provider. Independence matters: a backup inside the same account and same vendor does not protect against account-level incidents.
  2. **Write-before-delete discipline:** never `remove()` then `upload()`. Upload to a new key, verify, then flip a pointer. This makes every write atomic and trivially revertible.
  3. **Test a restore.** An untested backup is a belief, not a control. Schedule one restore drill before the first enterprise customer signs.
  4. Note that Root Cause A's migration *also* mitigates this — data in Postgres inherits PITR for free. This is another argument for prioritising it.

---

### ⚠️ Finding P0-9 — Zero Production Observability

* **Priority:** `P0` · **Effort:** `S` · **Blast Radius:** Availability · **Status:** 🟡 Partial
* **Evidence:** `✅ VERIFIED IN CODE` — `@sentry/nextjs` is a dependency; `src/lib/observability/sentry-init.ts` inits only when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` is set, with credential scrubbing. Production still needs the DSN in host env. Structured `[metric]` logs emit without Sentry.
* **Why this is a P0:** this document catalogues ~45 known failure modes. Without telemetry you cannot answer the only question that matters at 3 a.m.: *which one just fired, for which customer, how often?* `console.error` on Render is ephemeral, unsearchable across restarts, and un-alertable. The practical consequence is that **your enterprise customer becomes your monitoring system** — you learn about outages from an angry email, which is precisely the experience that loses a large account.
* **Why it's `S` effort and therefore inexcusable:** Sentry's Next.js SDK is roughly an hour of work and instruments both server routes and client errors.
* **Fix:**
  1. Install Sentry (or equivalent) with `tracesSampleRate` low and error capture at 100%.
  2. **Tag every event with `workspace_id` and `job_run_id`.** Untagged errors in a multi-tenant system are nearly useless; tagged errors let you answer "is this one customer or all customers?" instantly — the first triage question.
  3. **Scrub aggressively.** Configure `beforeSend` to strip `config`, `admin_api_token`, `application_password`, and `Authorization` headers. Given P0-7, an unscrubbed error tracker would export plaintext store credentials to a third party.
  4. Add uptime checks on `/api/embed/content` (customer-visible) and alerting on job failure rate.

---

### ⚠️ Finding S-1 — Middleware Uses `getSession()` Instead of `getUser()`

* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** Security · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/lib/supabase-middleware.ts:57-61`, with the deliberate comment *"Use getSession() instead of getUser() — reads from cookies locally, no network round-trip (~400-800ms saved per navigation)"*.
* **The trade-off, stated fairly:** the performance reasoning is legitimate and the latency saving is real. But Supabase's own guidance is that on the server `getSession()` **does not revalidate the JWT** — it decodes whatever the cookie contains. `getUser()` verifies against the auth server.
* **Why the actual risk here is *Medium*, not Critical** (and why honest severity matters): this check only gates *page navigation*. Three independent controls sit behind it — API routes call `supabase.auth.getUser()` themselves (verified in 27 route files), `getWorkspaceContext` enforces membership, and RLS enforces isolation at the database. So a forged cookie yields an empty shell page, not data. The defect is that the outermost layer is decorative, which is a defence-in-depth weakness rather than an open door.
* **Fix (keeping the performance win):** validate the JWT signature locally in middleware using the project's JWT secret / JWKS. This is cryptographic verification with **no network round-trip** — you keep the 400–800ms saving and get a real check. This is the standard pattern for edge middleware and strictly dominates both alternatives.

---

### ⚠️ Finding S-2 — Vulnerable `xlsx` Dependency

* **Priority:** `P1` · **Effort:** `S` · **Blast Radius:** Security · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `package.json:47` pins `"xlsx": "^0.18.5"`. *(superseded — `xlsx` removed; parsing/writing uses `exceljs`.)*
* **Why this matters:** `0.18.5` is the final SheetJS release published to the npm registry and carries known high-severity advisories (prototype pollution; ReDoS). Fixed versions are distributed only from SheetJS's own CDN, so `npm audit fix` **cannot** resolve it — teams routinely assume a clean audit means a clean tree.
* **Why the exposure is real for this app specifically:** `xlsx` parses **untrusted merchant-supplied files** across the products, categories, import, gallery and visualizer flows. That is exactly the threat model these advisories describe, and parsing happens both in-browser and server-side.
* **Fix:** install from the vendor CDN (`npm i https://cdn.sheetjs.com/xlsx-0.20.x/xlsx-0.20.x.tgz`) or migrate parsing to `exceljs`, which is already a dependency and already used for writing — consolidating on one library also removes a class of format-drift bugs between reader and writer.

---

### ⚠️ Finding S-3 — Timing-Unsafe Cron Secret Comparison

* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** Security · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/lib/auth/cron-secret.ts` uses `crypto.timingSafeEqual` on equal-length buffers; jobs sweep, Growth Sync tick, and storage expiry cron all call `cronSecretMatches`.
* **Why it's worth one line of code:** `===` on strings short-circuits at the first differing byte, so response time leaks a prefix-match oracle. Over the network, jitter makes this hard to exploit, which is why this is `P3` and not higher. Use `crypto.timingSafeEqual` on equal-length buffers — the correct habit costs nothing and this same pattern will be copied into future webhook handlers where it matters more.

---

### ⚠️ Finding S-4 — No Audit Trail For Security-Relevant Mutations

* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Compliance · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/app/api/team/members/route.ts` performs role changes and member removals with correct authorization checks (`401`/`403` at lines 43, 76, 118, 132, 204) but writes no audit record. Same for integration connect/disconnect and workspace deletion.
* **Why an enterprise buyer will block on this:** SOC 2 (CC6.1–CC6.3) and ISO 27001 A.9 require **immutable, attributable records of authorization state changes**. A security questionnaire will literally ask "can you show who granted this access and when?" Today the answer is no — the current role is stored, but the transition is not. Note also that the correct authorization checks you already have are unverifiable without a log: you can *say* only owners change roles, but you cannot *demonstrate* it.
* **Fix:** append-only `security_audit_logs(workspace_id, actor_id, action, target_id, before jsonb, after jsonb, ip, user_agent, created_at)` with `INSERT`-only RLS and no `UPDATE`/`DELETE` grant — immutability must be enforced by the database, not by convention. Log role changes, member removal, invite create/revoke, integration credential changes, and workspace deletion. Retain 12 months minimum.

---

### ⚠️ Finding S-5 — Tenant Deletion Is Implemented, But Can Strand Files Permanently

* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Compliance / Data Loss · **Status:** ✅ Done
* **Correction to earlier revisions of this document:** an earlier draft listed GDPR tenant deletion as "unverified — possibly orphans Storage objects". **That was too pessimistic.** `✅ VERIFIED IN CODE` — a real purge implementation exists and is better than assumed:
  - `src/app/api/workspaces/delete/route.ts` authenticates, then verifies `role === "owner"` (line 31) before acting.
  - `src/lib/workspace-purge.ts` recursively enumerates every object under the `${workspaceId}/` prefix (`listStoragePathsUnderPrefix`), removes them in batches of 100, then deletes the `workspaces` row so DB cascades fire (`add_cascade_deletes.sql`).
  - Storage paths are already tenant-prefixed (`${workspaceId}/...`), which is exactly the layout that makes targeted per-tenant erasure possible. **This is the single most important precondition for GDPR Article 17 in a shared bucket, and it was designed correctly.**

**Three real defects remain, in descending severity:**

1. **The delete order guarantees permanent orphans on partial failure.** `deleteStoragePrefix` swallows batch errors and continues:

```44:48:src/lib/workspace-purge.ts
    if (error) {
      console.error("[deleteStoragePrefix] batch failed:", error.message);
      continue;
    }
```
   `purgeWorkspace` then deletes the `workspaces` row **unconditionally**, regardless of how many batches failed. **Why this is the worst kind of bug:** once the workspace row is gone, nothing in the system references that `workspaceId` any more — so the surviving objects are unreachable, un-enumerable by any future cleanup job, and invisible to an erasure report. They are personal data you can neither find nor prove you deleted. The published pattern for tenant deletion is explicit that external stores must be **verified** before the owning record is released; deleting the index before the data is the canonical anti-pattern.
2. **It is a synchronous hard delete inside an HTTP request.** An enterprise workspace can hold tens of thousands of objects; `list` pages at 100 and `remove` batches at 100, all sequentially, inside one request. On Render this risks termination mid-purge — which lands directly in defect 1 above. There is also no grace window: a mis-clicked deletion is instantaneous and irreversible, and per **P0-6** there is no backup to restore from.
3. **No erasure record.** Nothing is written proving what was deleted and when, which is precisely the artefact an Article 17 request requires you to produce.

**Fix — the researched pattern, in order:**
1. **Two-phase deletion: soft-delete → grace window → hard purge.** Mark the workspace `deleted_at` and immediately block all access (the registry, not the bytes, is the authorization boundary). Absorb accidental and fraudulent deletions during the window, then hard-purge on a schedule. **Why the grace window is mandatory rather than nice:** a `deleted_at` flag alone does **not** satisfy Article 17 — soft state must always carry a deadline that promotes it to a hard delete. Both halves are required: immediate invisibility *and* guaranteed physical removal.
2. **Reverse the order and verify.** Purge Storage first, **assert zero remaining objects under the prefix**, and only then delete the DB row. If verification fails, leave the row in place and retry — a retained row is a recoverable state; an orphan is not.
3. **Make it a background job, and make it idempotent.** Reuse the existing `job_runs` infrastructure so it survives restarts and can be re-run safely. Idempotent fan-out is the standard shape for erasure orchestration.
4. **Write an erasure receipt** into `security_audit_logs` (Finding S-4): `{ workspace_id, actor_id, objects_deleted, tables_cascaded, completed_at }`. This is what turns "we deleted it" into something you can demonstrate.
5. **Document the backup retention answer.** Deleted data may legitimately persist in immutable backups until the retention period expires, provided it is no longer used and is purged on schedule. That is an acceptable answer — but only if the policy is written down before someone asks.

---

### ⚠️ Finding S-6 — RLS Is Enabled Everywhere, But No Policy Has Been Proven Correct

* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Security · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `ENABLE ROW LEVEL SECURITY` appears across 30+ tables in `supabase/migrations/**`. What has **not** been verified is whether each individual `CREATE POLICY` predicate actually restricts to the right tenant.
* **Why this deserves its own finding rather than a footnote:** the presence of RLS is currently doing real load-bearing work in this audit's risk assessment. It is the stated reason Finding S-1 is `P2` instead of critical, and it is the backstop behind **42 API route files that use the RLS-bypassing service-role client**. If a single policy is written as `USING (true)` — a common shortcut during development that is easy to leave behind — then that table has RLS "enabled" and no protection whatsoever, and the defence-in-depth argument collapses silently for that table.
* **Additional signal that warrants a look:** the migration filenames themselves (`add_missing_rls_policies.sql`, `fix_workspace_members_rls.sql`, `fix_team_invites_rls.sql`) show RLS was retrofitted and repaired iteratively. Iterative retrofits are exactly where coverage gaps and over-permissive interim policies survive.
* **Fix — cheap and mechanical:**
  1. **Enumerate reality, not intent:** query `pg_policies` on both databases and diff. **Why query the catalog rather than read the migrations:** the migrations tell you what was *attempted*; `pg_policies` tells you what is *in effect*, including anything applied manually outside version control (a real risk given the two-database setup).
  2. **Flag every policy whose `USING`/`WITH CHECK` clause does not reference a tenant key** (`workspace_id` via membership, or `auth.uid()`). Any `true` predicate is a finding.
  3. **Confirm `FORCE ROW LEVEL SECURITY` is not needed for table owners**, and that no table has RLS enabled with *zero* policies (which silently denies all anon access — safe, but usually indicates an oversight rather than a decision).
  4. **Write one negative test per core table** using two seeded tenants and the anon key: tenant B must read zero rows of tenant A. **Why a test rather than a review:** a review proves the policy was correct on the day you read it; a test keeps proving it after the next migration. Do this now, while both databases are seedable and disposable.

---

## 🛡️ Universal Guardrails & Upload Limits Matrix

> **Principle:** every ingestion path needs a bound. An unbounded upload does not degrade gracefully — it OOMs a worker, freezes a browser tab, or silently burns a quota. **Every row below now carries a verified implementation status**, because an assumed limit is a liability (Root Cause C).

| # | Upload Flow | Max File Size | Max Rows / Items | Types | Status (verified) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **Products** (`/products/upload`) | 25 MB XLSX / 50 MB CSV | 50,000 rows (or plan `maxProducts`) | xlsx, xls, csv | ✅ Client + `/api/products/catalog` |
| 2 | **Categories** (`/categories` import) | 10 MB / 20 MB | 5,000 categories, depth ≤ 6 | xlsx, xls, csv | 🟡 Client file/row check; no dedicated API |
| 3 | **Catalog Intelligence** (`/import/new`) | 30 MB / 60 MB | 25,000 rows | xlsx, xls, csv | ✅ Client + `/api/import/sessions` |
| 4 | **Products Gallery** (`/products-gallery`) | 20 MB | 5,000 products | xlsx, xls, csv | ✅ Size + row cap on API and parser |
| 5 | **Visualizer** (`/products-visualizer`) | 20 MB; assets 10 MB | 1,000 products | xlsx, csv + images | ✅ Size + row cap on API and parser |
| 6 | **Image Classification** | 5 MB/image, 250 MB batch | **200 images** | jpg, png, webp | ✅ Enforced client (`new/page.tsx:43`) **and** server (`api/image-classify/route.ts:544`) |
| 7 | **Website Restructure** | 8 MB/image | 10 images + logo | png, jpg, webp | ✅ Enforced (`api/website-restructure/assets/route.ts:14,60`) |
| 8 | **Store Assistant** (`/sync`) | per-type check present | 5,000 rows interactive / 50,000 bulk | live API + files | 🟡 File size checked (`sync/page.tsx:211`); **no row cap** |
| 9 | **Market Research** | live store API | 5,000 collections / 25,000 keywords | API | ❌ Unverified |
| 10 | **Custom Formula / AI Function** | n/a | 1,000 exec/min/workspace; 500ms/row timeout | in-app | ❌ Unverified |

### Why the *pattern* of these gaps matters
The three flows with **zero** limits (products, categories, import) are precisely the three highest-volume enterprise entry points — and they are the ones that feed Root Cause A's blob writes. The flows that *are* protected (image-classify, website-restructure) were built later, which suggests the discipline improved over time; the fix is to retrofit the earlier flows, not to invent new policy.

### Enforcement Rules (each with its reason)
1. **Sniff `file.size` before parsing.** `XLSX.read()` allocates several times the file size in JS objects; checking after the parse is checking after the crash.
2. **Enforce on the server too.** `✅ VERIFIED` that image-classify does this on both sides — copy that pattern. Client-only limits are bypassed by a direct API call.
3. **Cap rows after header detection, before row materialisation.** File size is a poor proxy: a 5 MB CSV can hold 400,000 rows.
4. **Return a specific, actionable error.** `"Row 4,512: SKU is empty"` lets the merchant fix it in 30 seconds; `"Upload failed"` produces a support ticket.
5. **Reject `.xlsm` macro-enabled workbooks** — no legitimate need, and it narrows the parser attack surface (see S-2).
6. **Check plan quota before dispatching any job** (see P0-5), so a rejected upload costs zero compute.

---

## 1. Products Catalog (`/products`, `/products/upload`)

### 📌 Scope
`src/app/(dashboard)/w/[workspaceSlug]/products/page.tsx`, `products/upload/page.tsx`, `src/lib/storage-helpers.ts`, `storage-helpers-server.ts`, `src/lib/excel.ts`

### Issue 1.1 — Entire Catalog Downloaded Into The Browser
* **Priority:** `P1` · **Effort:** `L` (`S` once Root Cause A lands) · **Blast Radius:** UX / Cost · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `products/page.tsx:70` calls `loadProductsJson(workspace.id)`; `page`/`pageSize` state (lines 44–45) paginates **in memory only**.
* **Why it happens:** direct consequence of Root Cause A — a blob has no `LIMIT`, so "load everything then slice" is the only option available.
* **Why it hurts at enterprise scale:** 50,000 products × 30 fields ≈ 30–100 MB of JSON per page open. `JSON.parse()` of that size blocks the main thread for seconds (it is synchronous and unyieldable), so the tab is frozen — not slow, frozen. Repeat on every navigation, per user, per tab. The pagination UI is therefore **cosmetic**: it reduces rendered rows but not a single byte of transfer or parse cost, which is the actual bottleneck.
* **Fix:** `GET /api/products?page&limit&search` backed by a Postgres table with an index on `(workspace_id, sku)`. Standard keyset pagination. **Why keyset over `OFFSET`:** `OFFSET 40000` still scans and discards 40,000 rows; `WHERE sku > $cursor ORDER BY sku LIMIT 50` is constant-time regardless of depth — the difference becomes decisive exactly at the catalog sizes this audit targets.

### Issue 1.2 — Search Filters The Full Array On Every Keystroke
* **Priority:** `P1` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — search state at `products/page.tsx:43`, filter uses `Object.values(p.data || {}).some(...)`.
* **Why it hurts:** every keystroke scans 50,000 products × 30 values = 1.5M string comparisons, synchronously, inside React's render path. Typing "shirt" triggers this five times. The result is dropped keystrokes — the single most viscerally "broken-feeling" UX defect a tool can have.
* **Fix and why this one is worth doing *today*:** a 250–300 ms debounce is a handful of lines and delivers the largest perceived-quality improvement per unit effort in this entire document. The 300 ms figure is not arbitrary — it sits just above typical inter-keystroke interval (~150–200 ms) so the filter runs once per *word* rather than once per *letter*, while staying under the ~400 ms threshold at which users start perceiving lag. Pair with server-side search (Issue 1.1) for the real fix.

### Issue 1.3 — Column Extraction Iterates The Whole Dataset
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Why it hurts:** the `dataColumns` `useMemo` walks every product's every key to build the column list — ~1.5M iterations whenever `allProducts` changes.
* **Fix:** persist a column manifest (`products.columns.json`, or a `workspace_columns` table) at ingest time. **Why a manifest rather than sampling:** sampling the first 500 rows is faster but silently drops columns that only appear in later rows, producing invisible data loss in the UI. Computing once at write time is both correct and \(O(1)\) at read time.

### Issue 1.4 — Deletion Re-Uploads The Entire Catalog
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Data Loss · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `saveProductsJson(workspace.id, remaining)` after client-side filter.
* **Why this is a data-loss risk and not just slow:** deleting one product rewrites all 50,000. If the connection drops mid-upload, the blob can be left truncated or the write lost — and per P0-6 there is **no prior version to restore**. Worse, the delete is computed from a client snapshot, so any product added by a colleague after that snapshot loads is **silently erased**. That is a lost-update anomaly with no error message.
* **Fix:** `DELETE /api/products` taking IDs, executing a server-side row delete. Root Cause A makes this a one-line `DELETE ... WHERE sku = ANY($1)`.

### Issue 1.5 — Embedded Excel Images Become Inline Base64
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `parseExcelFile` strips `data:image` cells; `extractEmbeddedWorkbookImages` returns binaries; products upload writes Storage paths (`vz-storage:`). Other Excel parsers still skip inlining without a Storage upload.
* **Why it hurts:** Base64 inflates binary by ~33%, and these strings land in row data that is then held in React state *and* written into the catalog blob. A 2,000-row sheet with photos produces hundreds of MB in browser memory and permanently bloats every subsequent read of the catalog. This is the mechanism by which one bad upload degrades the product page forever.
* **Fix:** during ingest, stream each extracted image to Storage and replace the cell with its path. **Why paths and not URLs:** signed URLs expire; storing a stable path and signing at render time (the pattern already used correctly by the visualizer's `vz-storage:` tokens) means stored data never goes stale. Reuse that proven approach here.

---

## 2. Categories & Taxonomy (`/categories`)

### 📌 Scope
`categories/page.tsx`, `src/app/api/categories/route.ts`, `storage-helpers*.ts`

### Issue 2.1 — Recursive DOM Tree Without Virtualization
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** UX · **Status:** ✅ Done
* **Why it hurts:** recursive `renderNode(node, depth)` mounts a real DOM node plus event handlers for every visible descendant. At 2,000–8,000 categories with branches expanded, layout/paint cost grows linearly and expand/collapse becomes visibly janky.
* **Fix:** flatten expanded nodes into a virtual list (`@tanstack/react-virtual` — **already a dependency**, and already used successfully in `data-table.tsx`, so this is a pattern transfer, not new tech) and keep expansion state in a `Set<string>`. Render only the ~40 rows in viewport. **Why flatten rather than optimise the recursion:** the cost is proportional to *mounted nodes*, so any approach that still mounts all of them (memoisation, `key` tuning) cannot fix it. Only rendering fewer nodes fixes it.

### Issue 2.2 — Product Counts Are Hardcoded To Zero
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** UX / Trust · **Status:** ✅ Done
* **Evidence:** `buildTree` sets `productCount: 0`; header metric and sidebar render literal `0`.
* **Why it matters more than it looks:** taxonomy work is *driven* by counts — merchandisers need to find empty categories and over-stuffed ones. A permanently-zero number is worse than a missing one, because it looks like real data and quietly teaches the customer not to trust the UI.
* **Fix:** compute **direct** and **rollup** counts. Rollup (self + all descendants) is the number that matters for navigation planning. Persist as a sidecar/aggregate so the categories page never has to load the catalog — otherwise fixing this recreates Issue 1.1 here.

### Issue 2.3 — `isDescendant` Rescans The Array On Every `dragOver`
* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Why it hurts:** `dragOver` fires at pointer-move frequency (dozens/sec). Each call runs a recursive `.filter()` over all categories, so per-frame cost is \(O(N \times \text{depth})\) inside the 16 ms frame budget — the cursor stutters precisely during the interaction that most needs to feel direct.
* **Fix:** maintain a materialised path (`"root/apparel/mens"`) or an ancestor `Set` per node; the check becomes \(O(1)\). Materialised paths are the classic relational answer to hierarchy queries and additionally make Issue 2.4's fix trivial — one change, two problems.

### Issue 2.4 — Category Import Matches By Name Only
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Data Loss · **Status:** ✅ Done
* **Evidence:** `existingByName.set(c.name.toLowerCase(), c)`.
* **Why this corrupts real catalogs:** duplicate leaf names across branches are the *norm* in retail — `Electronics > Accessories` and `Apparel > Accessories`; `Men > Shoes` and `Women > Shoes`. Name is not a unique key in a tree; the (parent, name) pair is. Matching on name alone collapses distinct nodes and reparents subtrees under the wrong branch. The damage is **structural and silent** — the import "succeeds", and the merchant discovers a mangled taxonomy later, possibly after pushing it live.
* **Fix:** match on canonical full path (`Apparel > Accessories`) or explicit IDs; fall back to name only for roots. Add a dry-run preview showing adds/moves/merges before commit. **Why a preview is not optional:** taxonomy imports are destructive and hard to reverse; the industry norm for destructive bulk operations is confirm-what-will-change, not trust-and-apply.

### Issue 2.5 — Unsaved Draft Buffer, No Optimistic Locking
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** Data Loss · **Status:** ✅ Done
* **Why it hurts:** all edits live in React state until "Save", which then writes the whole tree. Two admins editing concurrently = last-writer-wins, and a refresh loses everything.
* **Fix:** atomic endpoints (`/reparent`, `/rename`) plus a revision/ETag rejected on mismatch with a "reload — someone else changed this" prompt. **Why optimistic (version check) rather than pessimistic (locking):** taxonomy edits are infrequent and conflicts rare, so a version compare costs nothing in the common case and avoids the lock-holder-disappears problem — the same reasoning that makes ETags the web's default concurrency primitive.

---

## 3. Catalog Intelligence & AI Enrichment (`/import`, `/import/[sessionId]/enrich`)

> **Note:** paths and identifiers in this section reflect the **current** code. They are scheduled for rename in Section 19.

### 📌 Scope
`import/page.tsx`, `import/[sessionId]/enrich/page.tsx`, `src/components/data-table.tsx`, `src/store/sheet-store.ts`, `src/lib/jobs/enrich-session.ts`, `enrich-row.ts`, `src/app/api/import/apply/route.ts`

### Issue 3.1 — Full `project.json` Upload After Every Row  ⟶ **P0-3**
* **Priority:** `P0` · **Effort:** `M` · **Blast Radius:** Cost / Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/lib/jobs/enrich-session.ts` `commit()` patches one `catalog_session_rows` row (hot path) and flushes `projects/{sessionId}.json` only on the checkpoint budget. Rollback: `CATALOG_ROW_STORE=0`.
* **Why the numbers are catastrophic:** 10,000 rows × a 15–40 MB document = **150–400 GB of Storage writes for one job**. Supabase Pro includes 250 GB/mo egress. **A single enterprise enrichment run can exceed your entire monthly paid quota.** This is not a performance issue; it is a billing and availability incident.
* **Second-order harm:** because writes go through a serialized `writeQueue`, the upload becomes the pipeline's critical path. Concurrency 8 on the AI calls is wasted — all eight workers queue behind one blob upload. **You are paying for parallelism you cannot use.**
* **Fix — two-tier persistence (Root Cause B):**
  - **Hot state, every row:** `job_runs` heartbeat with `completed_count`, `failed_count`, `processedRowIds`. A Postgres row update is a few hundred bytes and is what progress UI actually reads.
  - **Cold state, at checkpoints:** persist the full artifact every 50–100 rows, every ~30 s, and on pause/complete/fail.
  - **Why this is safe:** the only cost of a crash is re-doing work since the last checkpoint. With `processedRowIds` in the DB, resume skips completed rows, so **no AI credits are re-spent** — the exact trade-off Temporal/Sidekiq make. Reduction: ~10,000 blob writes → ~150. Roughly **99% less egress.**
  - Week 6 landed the Catalog Intelligence half of Root Cause A: per-row `UPDATE catalog_session_rows` on the hot path; the blob remains a cold checkpoint.

### Issue 3.2 — Match Types Recomputed On Every Workspace Load
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `catalog-intelligence/[sessionId]/page.tsx` calls `shouldRecomputeMatchTypes` and skips rematch when every row already has `existing`/`new`. Matching still runs on the match step and persists per row.
* **Why it hurts:** opening a saved session downloads the entire master catalog (Issue 1.1's payload) and recomputes 10,000 × 50,000 matching in the browser before the table renders.
* **Fix:** compute during the matching step, persist per row, treat as immutable in the workspace with an explicit "Re-run matching" action. **Why:** match type is a *derived fact about a point in time*, not live state. Recomputing it on read is both expensive and semantically wrong — it can silently change historical rows under the user.

### Issue 3.3 — Zustand State + Unbounded Undo Stack
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/store/sheet-store.ts` `recordUndo()` caps the stack at 30. `deleteRows` still snapshots the deleted rows (needed to restore); depth is what was unbounded.
* **Why it hurts:** 20,000 rows × 30 columns with `originalData` + `enrichedData` + full undo history can exceed 250–500 MB in-tab, pushing V8 into frequent major GC — which appears to the user as random multi-hundred-ms freezes while typing.
* **Fix:** cap history at ~30 entries and store cell-level deltas (the `{ type: "cell", rowId, column, oldValue, newValue }` shape is already correct — the problem is only the unbounded `deleteRows` snapshots and depth). **Why 30:** empirically beyond ~20 steps users navigate by re-editing, not by undoing, so deeper history costs memory for behaviour that does not occur.

### Issue 3.4 — Virtualization Present, Measurement Still Costly
* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** UX · **Status:** 🟡 Partial
* **Evidence:** `✅ VERIFIED IN CODE` — `data-table.tsx` uses `@tanstack/react-virtual` with `estimateSize: () => 44, overscan: 20`. **This is already correct and is a strength.**
* **Remaining edge:** dynamic measurement means a column resize invalidates the height cache for all rows; per-cell tooltips/image loaders add listener churn.
* **Fix:** fixed row heights for large pages and `React.memo` on cells with a targeted equality check (`prev.enrichedData === next.enrichedData && prev.status === next.status`). **Why reference equality is enough:** updates already replace row objects immutably, so identity comparison is both cheap and correct — a deep comparison would cost more than the render it avoids.

### Issue 3.5 — Master Catalog Apply Has No Concurrency Control  ⟶ **P0-4**
* **Priority:** `P0` · **Effort:** `M` · **Blast Radius:** Data Loss · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/app/api/catalog-intelligence/apply/route.ts` CAS-uploads `products.json` via `saveCatalogWithCas` and reads the master catalog from `workspace_products` when `PRODUCTS_ROW_STORE` is on.
* **Why this is a P0:** this is a textbook lost-update race with no guard. Two team members applying two sessions concurrently — routine in a 20-seat enterprise team — results in the second write **silently discarding** the first's enrichment. No error, no warning. The customer discovers that an afternoon of AI work vanished, cannot reproduce it, and stops trusting the tool. Trust, once lost this way, does not come back.
* **Why it's ranked above the many "High" performance issues:** slow is visible and forgivable; silently wrong is invisible and fatal.
* **Fix (in preference order):**
  1. **Best — Root Cause A:** row-level upserts into Postgres. `INSERT ... ON CONFLICT (workspace_id, sku) DO UPDATE` is atomic per row, so concurrent applies to *different* SKUs cannot conflict at all and same-SKU applies serialize correctly.
  2. **Interim — optimistic version tag:** store `version` alongside the blob; on save, compare-and-swap and reject on mismatch so the caller retries against fresh data. **Why CAS rather than a mutex:** it needs no lock lifecycle, cannot deadlock, and cannot strand a lock if a worker dies mid-apply.
  3. Serialize applies per workspace via an advisory lock as a stopgap.

---

## 4. Visual Intelligence — Image Classification (`/image-classify`)

### 🌟 Strengths
1. **Client-side canvas downscaling** — `thumbnailImage(file, 1024)` re-encodes before upload. **Why it's the right call:** it moves compression cost to idle client CPU and cuts ~80% of bandwidth *before* it becomes a server problem. This is exactly the pattern Issue 11.1 is missing, and evidence the team knows the technique.
2. **Long-lived signed export URLs** — exported CSV/JSON links keep working, so downstream spreadsheets don't rot.
3. **`sanitizeSku` + negative prompting** — keeps model prose out of SKU fields; treating LLM output as untrusted and normalising it is correct discipline.
4. **Token-level billing transparency** — `candidatesTokens`/`promptTokens` recorded in usage metadata.
5. **Limits enforced on both client and server** — `✅ VERIFIED` at `new/page.tsx:43` and `api/image-classify/route.ts:544`. **This is the reference implementation** other flows in the guardrails matrix should copy.

### Issue 4.1 — Hard Cap Of 200 Images
* **Priority:** `P2` · **Effort:** `L` · **Blast Radius:** Commercial · **Status:** ❌ Open (by design)
* **Why the cap is currently *correct*:** given Issue 4.2's memory model, 200 is a responsible bound, not an oversight. Raising it without fixing 4.2 would trade a clear error for an OOM crash — strictly worse.
* **Why it eventually blocks enterprise deals:** photoshoot archives arrive with 2,000–20,000 images; manual splitting into 200-image batches is exactly the drudgery the product claims to remove.
* **Fix — three-stage hybrid pipeline (and why each stage exists):**
  1. **Embed** every image with a vision model (CLIP-class). Cheap, parallel, and turns an image into a comparable vector.
  2. **Pre-cluster** with dimensionality reduction + agglomerative clustering into macro-groups of 20–50 visually similar images. **Why:** grouping is a similarity problem, not a reasoning problem — using an LLM for it is orders of magnitude more expensive for no accuracy gain.
  3. **LLM-refine** each cluster (30–50 images) for SKU extraction and labelling. **Why:** the expensive reasoning model is now applied only where reasoning is actually required, and each prompt stays small enough to stay accurate. Cost scales roughly linearly instead of quadratically, and quality *improves* because context is locally coherent.

### Issue 4.2 — All Image Buffers Downloaded Into Heap Concurrently
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `api/image-classify/route.ts` downloads with `mapLimit(images, 6, ...)`.
* **Why it hurts:** `Promise.all` over 200 downloads has **no concurrency bound**; all buffers land in heap simultaneously and are then Base64-encoded (+33%). On Render Free (512 MB) this OOMs; on 4 GB it survives one job and fails when two run concurrently. An unbounded `Promise.all` over I/O is one of the most common Node.js production faults precisely because it works fine in testing with small inputs.
* **Fix:** bounded concurrency (`p-limit(6)`) plus, ideally, passing storage URIs to the model instead of inline Base64 — which removes the buffers from your process entirely. **Why bounding beats raising RAM:** memory then depends on the concurrency limit, not on user input, so the failure mode stops being data-dependent.

### Issue 4.3 — Sequential Browser Uploads, No Resumability
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** UX · **Status:** ❌ Open
* **Why it hurts:** losing connectivity at image 140/200 leaves an orphaned session with no resume path.
* **Fix:** accept a single `.zip` (server-side extraction in a worker) and/or resumable multipart uploads. **Why ZIP is the enterprise-friendly answer:** merchants' photography already arrives as archives, one HTTP request is atomic and retryable, and it eliminates 200 opportunities for partial failure.

### Issue 4.4 — Simulated Progress Bar
* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** UX / Trust · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — progress uses real job stages / an indeterminate hold, not `prev + Math.random()`.
* **Why it's worth fixing despite being cosmetic:** a fake bar that parks at 95% for two minutes actively destroys confidence — users conclude the job hung and cancel work that was succeeding. Progress indicators are a *trust* surface; when the real signal exists (`job_runs.completed_count`), simulating it is strictly worse than showing it.
* **Fix:** emit real stages ("Downloading 45/200", "Vision reasoning", "Writing groups") from the existing heartbeat. Where genuine progress is unknowable, show an indeterminate spinner — honest ambiguity beats a false number.

---

## 5. Visual Commerce Studio — Products Gallery (`/products-gallery`)

### 🌟 Strengths
1. **`withGalleryWorksheetLock`** — prevents revision collisions on concurrent row completion. Note this is the concurrency control Issue 3.5 lacks; the pattern already exists in-house and should be borrowed.
2. **Idempotent credit billing** — composite keys (`gallery_google:sessionId:rowId`) passed to `deduct_user_credits`. **Why it matters:** retries are inevitable in distributed work; without idempotency keys, every retry double-charges the customer. This is correct financial engineering.
3. **Runtime settings snapshotting** — job payload captures `imagesPerRow` etc. at dispatch, so later UI edits can't mutate a running job. This is the fix for a real bug found earlier in development and is the right general principle: **jobs must execute against the config they were created with.**
4. **Resumable recovery** — `runJobWithFailureGuard` marks interrupted rows retryable rather than losing them.
5. **Auth gate before privileged client** — `requireGalleryAuth({ workspaceId, requireWrite })` at `api/gallery/sessions/[sessionId]/route.ts:77,242`.

### Issue 5.1 — Full-Worksheet URL Signing Every 750 ms  ⟶ **P0-8**
* **Priority:** `P0` · **Effort:** `M` · **Blast Radius:** Cost / Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — client polls `GET /api/gallery/sessions/[sessionId]` every 750 ms; the route calls `signGalleryWorksheetImages(admin, hydratedWorksheet)` across **all** rows.
* **Why the arithmetic is alarming:** 1,000 products × 5 images = 5,000 HMAC signatures **per 750 ms**, i.e. ~6,600 signatures/second, returning a ~2 MB payload ≈ **2.5 MB/s sustained per open browser tab**. Ten merchants watching their jobs = 25 MB/s and a saturated Storage auth path. The client discards ~99% of it — it only needs the rows that changed.
* **Why it violates a basic API principle:** the response size is proportional to *dataset size* while the information content is proportional to *change rate*. Polling endpoints must return deltas, not snapshots.
* **Fix:**
  1. **Slim progress endpoint** — `/progress` returning `{ completed, failed, total, changedRowIds }`. Bytes now scale with change, not catalog size.
  2. **Page-scoped lazy signing** — sign only the ~125 images visible on the current page, on demand.
  3. **Back off the interval** — 750 ms is far below human perceptual need for a multi-minute job; 2–3 s with exponential backoff while idle cuts load ~4× for no felt difference.

### Issue 5.2 — Worksheet Serialized Twice Per Row
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Cost · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/lib/jobs/gallery-session.ts` calls `commitWorksheet()` on both the `generating` and the `ready`/`failed` transition.
* **Why it hurts:** 1,000 rows → **2,000 full-file uploads** in minutes. Same mechanism and same remedy as Issue 3.1 (Root Cause B). The `generating` marker in particular is pure hot state — it exists only to drive a spinner and has no business being written to object storage.
* **Fix:** transient status to `job_runs` heartbeat; artifact persisted every ~20 completions and on terminal transitions.

### Issue 5.3 — Bulk Excel Export Resolves Signed URLs Serially
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/lib/gallery/export-builder.ts` unique-path signs with `mapLimit(..., 20)` then builds the workbook from a Map.
* **Why it hurts:** 10,000 products × 5 images = 50,000 sequential awaits. At even 5 ms each that is 250 s of pure latency. (Correction to earlier drafts: on **Render** there is no hard 60 s cap — the real risk is a ~100 s no-bytes-sent termination and an unusable wait, not a fixed serverless timeout.)
* **Fix:** batch-sign in chunks of ~500 into a `Map`, then build the workbook from memory — turns 50,000 round trips into ~100. For >1,000 rows, run export as a background job that emails/links the artifact. **Why background is the correct model:** a request that takes minutes cannot be made reliable, only faster; large exports are jobs, and jobs need a result you can fetch after a disconnect.

---

## 6. Creative Product Agent — Visualizer (`/products-visualizer`)

### 🌟 Strengths
1. **`claim_visualizer_worksheet_revision` (DB RPC)** — monotonic revision claiming in Postgres. **Why this is the standout piece of engineering in the repo:** it makes stale overwrites *structurally impossible* rather than unlikely. This is precisely what Issue 3.5 needs — the solution already exists internally.
2. **Two-stage pipeline (description → approve → images)** — approval gate before the expensive step. **Why it matters commercially:** image generation dominates cost; letting merchants reject copy first avoids paying for images nobody will use.
3. **Canonical reference image** — passes the real product photo to the generator, preserving silhouette and branding. This is what separates usable output from generic stock-looking AI imagery.
4. **`vz-storage:` HTML tokens** — stored HTML holds stable paths, resolved to fresh signed URLs at render. **Why it's the right abstraction:** it decouples durable content from ephemeral credentials, so stored HTML can never contain an expired link. Issue 1.5 should adopt this.

### Issue 6.1 — Unbounded Effective Concurrency Against The Image API
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `IMAGE_PARALLEL = 1` in `process-images-row.ts`; each generation call goes through `withAiSlot` (`src/lib/ai/global-concurrency.ts`, max 8 in-flight process-wide).
* **Why this is a design flaw and not just a tuning value:** concurrency is being set implicitly as a *product of two independent local constants*. Nobody chose 32; it emerged. Whenever either constant changes, the real limit changes silently. Provider quotas are global, so the limit must be global too.
* **Why it hurts:** 32 concurrent calls will hit 429 / quota limits; without backoff, retries synchronise and amplify the overload (the classic thundering-herd failure).
* **Fix:** one **global token bucket** (6–10 concurrent) shared by all workers, with exponential backoff **plus jitter** on 429 and respect for `Retry-After`. **Why jitter specifically:** without it, all failed requests retry at the same instant and recreate the spike; jitter spreads them and is why AWS/Google both document it as mandatory rather than optional.

### Issue 6.2 — Worksheet Persisted Up To Three Times Per Row
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Cost · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `persistRevision()` on `generating`, `description_ready`, `images_ready`. 500 products ⇒ ~1,500 full uploads.
* **Fix:** identical to 3.1 / 5.2 (Root Cause B). Keep `claim_visualizer_worksheet_revision` — it guarantees correctness. The change is *frequency*, not mechanism: checkpoint every ~20 rows and on terminal states.

### Issue 6.3 — Brand Assets Re-Downloaded Per Row
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** Availability / Cost · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `brandAssetCache` in `process-images-row.ts` memoises job-invariant logo/guide downloads by storage path.
* **Why it hurts:** the logo and brand guide are **identical for every row in the job**, yet are re-downloaded and re-buffered 8× concurrently — 24–32 buffers resident where 2 would do, plus needless egress.
* **Fix:** load job-invariant assets once into a small LRU keyed by storage path, scoped to the job lifecycle. **Why job-scoped rather than global:** the cache lives exactly as long as the data is guaranteed valid, so a mid-job brand change cannot serve stale assets on the next run.

---

## 7. Growth Engine — Market Research & SEO (`/market-research`)

### 🌟 Strengths
1. **Verified internal link graph** — `buildInternalLinkGraph` cross-references the live catalog (`published !== false`, valid handle) so generated links resolve. **Why this is a genuine differentiator:** the standard failure of AI SEO tooling is confidently inventing 404s, which actively harms the site it was meant to help. Grounding link generation in real inventory is the correct answer.
2. **Deterministic intent tri-slicing + zero-product suppression** — separates commercial/informational/PDP intent and refuses to propose collections with no matching inventory. Prevents keyword cannibalisation and empty pages, both of which are ranking liabilities.
3. **Wallet hold → settle → refund** around external crawlers. **Why:** third-party crawl cost is unknown up front; holding an estimate then refunding the remainder is the only model that is both safe for you and fair to the customer.
4. **Jittered publish scheduling** — `buildPublishSchedule` spreads posts across realistic hours instead of dumping 50 at once, which is what a natural publishing cadence looks like to search engines.
5. **Idempotent push** — existing `storeCollectionId` / `storeArticleId` short-circuits re-push, preventing duplicate collections in the live store.
6. **Modular slice storage** — `saveProjectSliceAdmin` partitions state (`catalog`, `seeds`, `collections`, …). **Why worth highlighting:** this is Root Cause A being partially mitigated *correctly* — smaller blobs, partial writes. It shows the right instinct and is the closest existing analogue to the recommended table split.

### Issue 7.1 — Re-Tokenizing Documents Inside An \(O(K \times P)\) Loop
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `stage5-collection-clusterer.ts` builds `buildProductTermIndex(products)` once, then reuses term maps in the keyword loop.
* **Why it hurts:** 10,000 products × 500 keywords ⇒ **5,000,000** string builds + regex tokenizations, all producing *identical* results per product every time. This is redundant work, not necessary work: allocation churn drives major GC pauses and can stall the worker.
* **Fix:** hoist tokenization out of the loop — precompute each product's term-frequency map and vector magnitude **once** in \(O(P)\), then the inner comparison is a sparse dot product. Better still, invert the index (term → products) so only products sharing a term are visited at all; most keyword/product pairs share nothing, so the vast majority of the 5M comparisons are provably zero and can be skipped. **Why this is the textbook answer:** it is how every search engine works, for exactly this reason.

### Issue 7.2 — Intent Classification Batches Run Sequentially
* **Priority:** `P1` · **Effort:** `S` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `stage4-intent-classifier.ts` runs batches with `mapLimit(batches, 4)`.
* **Why it hurts:** 3,000 keywords ⇒ 50 batches × ~3 s ⇒ **~150 s wall clock**, and each batch is pure network wait — the CPU is idle the whole time. Sequential I/O is the single most common avoidable latency bug in AI pipelines.
* **Fix:** `p-limit(4)` ⇒ ~35–40 s. **Why 4 and not 50:** concurrency must respect the provider's rate limit; unbounded parallelism converts a latency problem into a 429 storm (see 6.1). Route it through the same global token bucket so all AI callers share one budget.

### Issue 7.3 — Whole Collection Catalog Dumped Into The Stage-1 Prompt
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** Cost / Quality · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `compressCollectionsForStage1` keeps the top 150 collections by product count and records overflow counts (`stage1-catalog.ts`).
* **Why it hurts twice:** at 2,500+ collections the prompt can exceed 150k tokens, so (a) cost and latency scale with catalog size, and (b) **accuracy degrades** — long-context recall falls in the middle of very large prompts, and the risk of truncated/invalid JSON output rises. More context is not more quality past a point.
* **Fix:** hierarchical pre-filtering — send top-level/parent collections with aggregated counts to identify niches, then map leaves deterministically in code. **Why:** leaf mapping is a lookup, not a judgement; spending model tokens on deterministic work buys nothing. Note `compressTaxonomyTree` (Module 11) already solves this well — reuse it.

### Issue 7.4 — Sequential, Unthrottled Collection Push To Store APIs
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — Market Research push uses `createShopifyCollection` from `src/lib/sync/providers/shopify` (GraphQL `throttleStatus` + HTTP 429 `Retry-After`) and waits 400 ms between collection creates. Not GraphQL bulk mutations.
* **Why it hurts:** Shopify enforces a leaky-bucket limit (bucket ~50, refill ~2/s REST; cost-based for GraphQL). A tight loop drains the bucket and then 429s; WooCommerce on shared hosting exhausts PHP/MySQL workers instead — and can take the merchant's storefront down with it. **Damaging a customer's live store is categorically worse than being slow.**
* **Fix:** token-bucket pacing that mirrors the provider's own bucket, honour `Retry-After` and Shopify's `throttleStatus`, exponential backoff with jitter, and prefer GraphQL bulk mutations for large pushes. **Why mirror rather than guess:** Shopify publishes remaining bucket capacity in every response; a client that reads it can run at the true maximum safe rate instead of a conservative guess.

---

## 8. Storefront Widgets & Live Theme Embeds (`/customize`, `/api/embed/content`)

### 🌟 Strengths
1. **Fully client-side style editing** — instant preview, no backend round-trip per tweak.
2. **Dual deployment** — script embed *and* native Shopify OS 2.0 app block, so the widget fits both legacy and modern themes.
3. **Graceful empty rendering** — unknown handles return `{ faqs: [], links: [] }` instead of throwing. **Why this matters more than it sounds:** this code runs inside the customer's live storefront. A thrown error there can break their page and cost them sales; failing quietly is the only acceptable behaviour for third-party embed code.
4. **Handle-required guard** — `✅ VERIFIED IN CODE` at `route.ts:152`, returns empty when no handle, with the comment *"guessing would leak content onto unrelated pages."* **The right instinct is already present in this file** — which is exactly why Pass 2 (P0-2) needs deleting: it is the same guessing this guard refuses.

### Issue 8.1 — Live Shopper Traffic Reads Storage Slices On Every Pageview
* **Priority:** `P1` (security aspects are `P0-1`/`P0-2`) · **Effort:** `M` · **Blast Radius:** Cost / Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `GET /api/embed/content` looks up `embed_page_cache` by store domain + handle, upserts on miss, and sends `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.
* **Why it hurts:** worst case ~40 Storage blob downloads plus 3 DB queries **per shopper pageview**, with `Promise.all` inside a loop over projects. At 100,000 pageviews/day that is potentially millions of blob reads — exhausting egress, saturating the DB pool, and adding 500–2,000 ms to a page your customer's revenue depends on. **The customer's conversion rate becomes a function of your cache strategy.**
* **Fix (each part with its reason):**
  1. **Denormalise into a flat cache at write time** — on push/generate, write `store_domain + handle → { faqs, links, widgetSettings }` into one indexed table. Public reads become a single primary-key lookup. **Why:** this is a read-heavy, write-rare workload — precomputing at write time is the canonical answer, and it happens to eliminate the P0-1 credential exposure as a side effect.
  2. **Cache at the edge** — `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`. **Why `stale-while-revalidate` specifically:** shoppers get an instant cached response while the CDN refreshes in the background, so origin problems never become storefront problems. Serves ~99% of traffic in <15 ms without touching your infrastructure.
  3. **Lock down CORS** — `Access-Control-Allow-Origin: *` (`route.ts:27`) is currently required because the endpoint is public, but once tenant domains are registered (P0-2's `workspace_domains`), reflect only verified origins.

---

## 9. Automated Classification — Growth Sync (`/growth-sync`)

### 🌟 Strengths
1. **Timestamp watermarks** — advance only past strictly-completed items, so an interrupted worker cannot drop or duplicate products. This is at-least-once processing done properly.
2. **Bulk-import truncation guard** — `result.truncated` detects a 5,000-product bulk import and advises a full research batch instead of choking the incremental worker. **Why notable:** it recognises that an incremental pipeline should *refuse* bulk work rather than attempt it badly.
3. **Exact-cost settlement** — hold, classify, refund the unused remainder (~\$0.0005/product).
4. **Grouped store mutations** — `applyDecisions` groups by `taxonomyRef`, turning 50 assignments into 3 API calls. Directly mitigates the class of problem in Issue 7.4.
5. **Full one-click undo** — every assignment is a reversible transaction in `gs_activity` that can remove the product from the live collection. **Why this is a serious trust feature:** autonomous agents writing to a live store are only acceptable if every action is reversible. This is the correct safety model for automation.

### Issue 9.1 — All Target Collections In Every Prompt
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** Cost / Quality · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `candidateTargetsForProduct` lexical-filters then caps at 15 candidates per product (`src/lib/growth-sync/classify.ts`).
* **Why it hurts:** 100 products × 1,000 targets = 100,000 implicit pairings in one prompt. Beyond cost, **precision drops** — a model asked to consider 1,000 options makes worse choices than one given the 12 plausible ones. Bigger prompt ≠ better answer.
* **Fix:** pre-filter with vector similarity to the top 10–15 candidate collections per product, then let the LLM decide among those. **Why:** retrieve-then-reason is the standard RAG pattern; it cuts tokens by ~98% *and* raises accuracy, because relevance filtering is a cheap deterministic task and final judgement is the expensive one.

### Issue 9.2 — Synchronous Cron Tick With A Fixed Budget
* **Priority:** `P2` · **Effort:** `L` · **Blast Radius:** Availability · **Status:** 🟡 Partial
* **Evidence:** `✅ VERIFIED IN CODE` — `api/growth-sync/tick/route.ts` claims 12 rules and runs them in `after()` after the HTTP response. Not a PgBoss/BullMQ worker pool; still in-process on the Next.js instance.
* **Why it hurts:** throughput is capped at 3 rules per tick **platform-wide**. Once hundreds of workspaces have rules due, the backlog grows monotonically — deferred rules mean products sit unclassified for hours, and the "automated" promise quietly fails. This is a scaling ceiling, not a bug: no amount of tuning fixes a fixed per-tick budget.
* **Fix:** the tick should only *enqueue*; a worker pool (PgBoss/BullMQ, or Supabase Edge Functions) executes concurrently per workspace. **Why enqueue-then-process:** it decouples scheduling from execution, so throughput scales with worker count instead of with cron frequency, and one slow tenant can no longer starve everyone else.

---

## 10. Wallet, Credits & Ledger (`/wallet`)

### 🌟 Strengths — The Strongest Subsystem In The Product
1. **`SELECT ... FOR UPDATE` inside Postgres functions** (`charge_workspace_wallet`, `credit_workspace_wallet`). **Why this is exactly right:** balance mutation is read-modify-write, so it *must* hold a row lock or concurrent jobs will double-spend. Doing it in a stored procedure means the lock and the update are in one transaction with no application-layer race window. This is the control Issue 3.5 is missing.
2. **Cryptographic idempotency keys** — retries return `duplicate: true` with the original transaction id. Non-negotiable for money over an unreliable network.
3. **`NUMERIC(12,4)` precision** — \$0.0001 granularity. **Why it matters:** per-product AI costs are ~\$0.0005; rounding to cents would either overcharge by 20× or round to zero. Also: `NUMERIC` not `FLOAT` — floating point must never hold money, and this was done correctly.
4. **Hold-and-settle** — caps runaway spend before dispatch, refunds the remainder after.
5. **`mergeSyncRunTransactions`** — collapses hold+refund legs into one readable line. **Why it matters:** internally-correct double-entry legs are confusing to customers; presentation-layer consolidation gives clarity without falsifying the ledger.

### Issue 10.1 — Full Ledger Sent To The Client, Paginated In Memory
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** UX / Cost · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `GET /api/wallet/transactions` keyset-paginates; `readWorkspaceWallet` uses `wallet_spend_summaries`. The wallet page no longer downloads the full ledger.
* **Why it hurts:** a Growth Sync rule at 50 products/hour generates **~36,000 rows/month**. The client downloads all of them (>10 MB) to display ten. Growth is unbounded and monotonic — this page gets permanently slower every single day it runs.
* **Fix:** `/api/wallet/transactions?cursor&limit&module` with keyset pagination on `created_at` and filtering in SQL. **Why keyset:** ledgers are append-heavy and read newest-first, which is precisely where `OFFSET` degrades worst and a cursor stays constant-time.

### Issue 10.2 — `remaining / total` Badge Can Read `3,112,534 / 3,200`
* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** UX / Trust · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — layout credits badge renders `{remaining} available` (`w/[workspaceSlug]/layout.tsx`).
* **Why it matters despite being cosmetic:** on a **billing** surface, a number that looks like an accounting error erodes trust in every other number you show. Bonus/top-up credits legitimately exceed the monthly base, so the display is arithmetically fine and semantically wrong: it compares two different things (lifetime available vs monthly allotment) with a `/`.
* **Fix:** show `Available: 3,112,534` with a tooltip breaking out `Monthly: 3,200 · Bonus: 3,109,334`. Reserve `x / y` for genuine same-unit ratios.

---

## 11. Website Restructure — Header Builder (`/website-restructure`)

### 🌟 Strengths
1. **Three focused AI passes** (vision brief → competitor grounding → code synthesis) instead of one mega-call. **Why this is the correct architecture:** each pass has one objective and a small context, which reduces hallucination and makes failures debuggable — you know *which* stage produced bad output. Single mega-prompts fail opaquely.
2. **Sandboxed iframe navigation guard** (`WR_PREVIEW_NAV_GUARD`) — capture-phase anchor interception stops `#` links from navigating the parent frame while still allowing mega-menu JS to run. A precise fix to a subtle problem.
3. **Self-contained HTML export** — inline CSS/JS with the logo baked in as a Base64 data URI. **Why:** the merchant's exported header must work forever, offline, with no dependency on your signed URLs. Correct trade-off: accept file size to gain permanence.
4. **`compressTaxonomyTree`** — caps at `MAX_TOP_TAXONOMIES = 150` by product count and folds the rest into `overflowCount` summaries. This is the disciplined prompt-budgeting that Issue 7.3 lacks; reuse it there.
5. **Multimodal chat attachments with intent heuristics** — paste a palette or a logo and the agent infers whether it's a replacement asset or a style reference.

### Issue 11.1 — Unscaled Screenshots Sent To The Vision Model
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** Cost / Availability · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `downloadWrImageAsInline` downscales with sharp (max edge 1280 JPEG) before the vision request.
* **Why it hurts:** 10 retina screenshots at ~8 MB, +33% Base64, ⇒ a **~100 MB** request body held in heap. Vision models downsample internally anyway, so the extra pixels buy **no accuracy** — you pay memory, bandwidth and latency for information the model discards.
* **Fix:** canvas-downscale to ≤1600 px at ~80% WebP/JPEG client-side (~300 KB each) before upload. **Why 1600 px:** it comfortably exceeds the tile resolution vision models actually consume while remaining readable for layout/typography inference. **Note the technique already exists in this codebase** — `thumbnailImage(file, 1024)` in image-classify. Reuse, don't rebuild.

### Issue 11.2 — Build Lease Cannot Be Reclaimed By Its Own Owner
* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `wr_projects.build_lease_by`; `tryLeaseWrProjectBuild(..., userId)` lets the lease owner reclaim.
* **Why it hurts:** a lease is the right mechanism (it prevents double-click duplicate builds), but if the NDJSON stream dies the lease survives up to ~5 minutes and the user is stuck behind `409 "A build is already running"` — punished for a network blip.
* **Fix:** record the lease owner (user + session/tab id) and allow that owner to reclaim or explicitly release it; add a heartbeat so an abandoned lease expires in seconds rather than minutes. **Why owner-reclaim is safe:** the lease exists to prevent *concurrent* builds, not to prevent the same user from retrying; the invariant is preserved.

---

## 12. Store Assistant — Data Operations Center (`/sync`)

> **Note:** paths and identifiers in this section reflect the **current** code. They are scheduled for rename in Section 19.

### 🌟 Strengths
1. **Adaptive mutation routing** — synchronous `productSet` for \(N \le 25\), staged JSONL + `bulkOperationRunMutation` above that. **Why this is exactly right:** small edits need low latency; large edits need throughput and rate-limit immunity. Choosing per size instead of forcing one path is the mature answer, and it is the fix Issue 7.4 needs.
2. **Dual-model routing** — fast model for planning/filtering/transforms, reasoning model with web grounding for research (missing barcodes, specs, manufacturer imagery). Cost and latency are matched to task difficulty rather than paying premium rates for trivial steps.
3. **Append-only media guard** — `planProductMedia` uses `productCreateMedia` and cross-references existing images. **Why critical:** this writes to a live store. An accidental replace would destroy the merchant's professional photography irreversibly. Append-only is the only defensible default.
4. **Interactive sheet** — undo/redo, quick prompts ("Products without images", "Missing SEO"), column profiles (Core/SEO/Media/Inventory/Metafields).
5. **Streaming NDJSON with mid-tool progress** — cells update row-by-row during long tools. **Why it matters:** on Render, streaming bytes also keeps the connection alive, so this simultaneously improves UX and reliability.
6. **File size validation present** — `✅ VERIFIED` at `sync/page.tsx:211`.

### Issue 12.1 — Full Sheet Snapshots In The Undo Stack
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** UX · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `src/lib/sync/sheet-history.ts` stores inverse cell patches when columns and row count are unchanged; full snapshot on shape change. Cap remains `MAX_SHEET_HISTORY = 5`.
* **Why it hurts:** 5,000 products × 20 columns ≈ 15 MB per snapshot; 10 turns ⇒ **150–300 MB** of browser RAM. Cost is \(O(\text{turns} \times \text{sheet size})\) when the information content is only \(O(\text{cells changed})\) — an edit touching 3 cells should not cost 15 MB.
* **Fix:** store inverse patches (JSON Patch, or Immer's `produceWithPatches`) — `{ rowIndex, column, oldValue, newValue }`. Memory becomes proportional to actual changes, enabling *deeper* history for far less RAM. **Why Immer patches specifically:** Zustand already relies on immutable updates, so patch generation is nearly free and requires no change to the mutation code.

### Issue 12.2 — Long AI Batch Runs Have No Checkpoint
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Data Loss / Cost · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — checkpoint every 20 completed rows to Storage; `GET/DELETE /api/store-assistant/checkpoint`; agent `resumeCheckpoint`; Resume/Dismiss banner on the Store Assistant page.
* **Why it hurts:** if the tab sleeps or connectivity drops at row 400/500, the stream dies and the remaining rows are abandoned — **and the credits already spent on completed-but-unpersisted rows are lost twice**: once paid, once re-paid on retry. That is a direct, visible billing injury.
* **Fix:** persist completed batches every ~20 rows to a session checkpoint, and expose "resume from last checkpoint". **Why 20:** it bounds worst-case lost work to a few seconds of compute while keeping write volume trivially low — the same reasoning as Issue 3.1, applied to a user-facing flow.

---

## 13. Usage Analytics & Credit Reporting (`/usage`)

### 🌟 Strengths
1. **Batched profile resolution, no N+1** — user ids de-duplicated into a `Set` and fetched with one `.in("id", ids)`. **Why worth crediting:** N+1 is the most common ORM-era performance bug; avoiding it deliberately here shows the pattern is understood.
2. **Per-member attribution** — owners can see which collaborator consumed credits, which is what enterprise cost-centre reporting requires.
3. **Fractional accuracy preserved** end-to-end (e.g. `87.466` credits over `122` operations).

### Issue 13.1 — "All-Time Used" Is Computed From The Latest 200 Rows
* **Priority:** `P1` · **Effort:** `S` · **Blast Radius:** Trust / Compliance · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `/api/credits` and `/api/usage` return `credit_usage_totals` from Postgres; the usage page renders `data.totalAllTime`.
* **Why this is worse than a performance bug:** a card labelled **"All Time"** shows a number that is not all-time. With 5,000 lifetime transactions it under-reports by orders of magnitude and **contradicts the invoice**. A customer who finds one wrong number on a billing page reasonably assumes the billing itself is wrong — and this one is `S` effort to fix, which makes shipping it indefensible.
* **Fix:** return `SUM(credits_used)` and `COUNT(*)` computed in Postgres (`/api/usage/route.ts` already does aggregate work — reuse it) and render the server value. **General principle: never derive a total from a truncated page.** Aggregates belong in the database; if a client can only see part of the data, it must not label anything "all".

### Issue 13.2 — No Date-Range Filter, No CSV Export
* **Priority:** `P2` · **Effort:** `S` · **Blast Radius:** Compliance · **Status:** ✅ Done
* **Fix landed:** `/api/credits?from=&to=&format=csv` plus date inputs and Export CSV on the usage page.
* **Why enterprise buyers ask for this immediately:** finance reconciles a monthly invoice against usage. Without "This Month"/"Last Quarter"/custom range and an export, reconciliation is manual — and a finance team that cannot tie your invoice to usage will escalate to procurement, not to support.
* **Fix:** server-side date filters plus a streamed CSV export. Pair with 13.1's aggregates so the exported total and the displayed total are computed the same way — divergent numbers are worse than a missing feature.

---

## 14. Team Management & RBAC (`/team`)

### 🌟 Strengths
1. **Hierarchical roles scoped per workspace** — Owner(4) / Admin(3) / Editor(2) / Viewer(1); billing and deletion reserved to Owner. Numeric ranks make "at least Admin" a comparison rather than a growing list of role checks.
2. **Seat quota counts pending invites** — `✅ VERIFIED IN CODE` — `/api/team/invite` sums `workspace_members` **plus** `workspace_invites WHERE accepted_at IS NULL`. **Why this specific detail matters:** counting only accepted members is the standard seat-limit bypass (invite 100 people, let them accept later). Closing it shows the threat model was actually considered. Note this makes seats the **only** enforced plan limit (see P0-5).
3. **32-byte random invite tokens with 7-day expiry**, plus upsert so re-inviting a removed member doesn't violate a constraint. Cryptographic randomness prevents enumeration; expiry bounds the window of a leaked link.
4. **Correct authorization on mutations** — `✅ VERIFIED IN CODE` — `team/members/route.ts` returns `401` unauthenticated (43, 118, 174), `403` non-member (76), and explicitly blocks changing/removing the owner (132, 188) and self-removal (193).
5. **Explicit permission matrix UI** — a colour-coded capability grid across all modules, so a team lead can verify access without reading code.

### Issue 14.1 — Member List Is Unpaginated
* **Priority:** `P3` · **Effort:** `S` · **Blast Radius:** UX · **Status:** ✅ Done
* **Fix landed:** team page paginates at 15/page with client name/email search.
* **Why it's genuinely low priority:** even 100 members is a small payload — this is the least urgent item in the document, and it is listed only so the omission is intentional rather than forgotten.
* **Fix:** paginate at 15/page with server-side name/email search when teams routinely exceed ~50.

### Issue 14.2 — No Audit Log On Role Changes Or Removals
* **Priority:** `P1` · **Effort:** `M` · **Blast Radius:** Compliance · **Status:** ✅ Done — **see Finding S-4 for the full treatment.**

---

## 15. Workspace Settings & Store Integrations (`/settings`)

### 🌟 Strengths
1. **Pre-flight credential handshake** — `testWorkspaceIntegration` must succeed before `saveWorkspaceIntegration` persists anything. **Why this is good design:** it fails at the moment of configuration, where the user has context to fix it, instead of surfacing as a mysterious sync failure days later. Fail fast, fail where the user is.
2. **Owner-only danger zone with name confirmation** — deletion requires typing the workspace name. Type-to-confirm is the standard for irreversible destructive actions because it defeats muscle-memory clicking.
3. **Provider config declared as schema** (`configFields` with `type`, `required`, `helpText`) — one source of truth for UI and validation, so adding a provider cannot drift out of sync with its form.

### Issue 15.1 — Store Credentials Stored As Plaintext JSONB  ⟶ **P0-7**
* **Priority:** `P0` · **Effort:** `M` · **Blast Radius:** Security / Compliance · **Status:** ✅ Done
* **Evidence:** `✅ VERIFIED IN CODE` — `workspace_integrations.config` holds `admin_api_token` / `application_password` as raw JSONB (schema at `settings/page.tsx:62-75`; consumed by `saveWorkspaceIntegration`).
* **Why this is P0 and not a hardening nicety:**
  - These tokens grant **write access to the customer's live store** — products, media, collections, potentially orders. Compromise means damage to *their* business, not just yours. That is the difference between an incident and an existential one.
  - Plaintext credentials reach **every** place the DB reaches: backup dumps, staging restores, `SELECT *` in a debugging session, log lines, and — per **P0-1** — the heap of a public unauthenticated endpoint on every shopper pageview. The combination of P0-1 and P0-7 is what makes both urgent; either alone is materially less severe.
  - No enterprise security review passes with third-party credentials at rest in plaintext.
* **Fix:**
  1. **Envelope-encrypt** with `pgsodium`/Supabase Vault or app-layer AES-256-GCM, key in the environment/KMS and **never** in the database — an encryption key stored beside the ciphertext provides no protection against the dump scenario this defends against.
  2. **Decrypt only in server runtimes at point of use**, never in any response payload.
  3. **Never `SELECT config`** unless the tokens are about to be used (fixes P0-1 as a by-product).
  4. **Store a non-sensitive display fingerprint** (e.g. last 4 chars) so the settings UI can show "connected" without decrypting.
  5. **Support rotation** — assume a token will eventually leak; the recovery path must be a rotation flow, not a support ticket.

---

## 16. Subscription, Plans & Stripe Billing (`/subscription`)

### 🌟 Strengths
1. **Stripe Customer Portal** — payment methods, invoices, cycle changes handled by Stripe. **Why this is the right build/buy call:** PCI scope, dunning, tax and invoice PDFs are enormous surface area; delegating them is both cheaper and safer than building them.
2. **Signature-verified webhooks** — see Section 0, Strength 3. The most important billing control in the system.
3. **Top-up minimum + presets** — `CREDIT_TOPUP_MIN_CREDITS = 100` at \$0.30/credit prevents uneconomic micro-charges where Stripe's fixed fee would exceed the purchase.

### Issue 16.1 — No Enterprise Tier Above Pro
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** Commercial · **Status:** ⛔ Out of scope
* **Decision:** no Enterprise / Contact Sales tier. Self-serve Starter/Pro only.
* **Evidence:** `✅ VERIFIED IN CODE` — plans cap at Pro (3,200 credits/mo, \$2,500) per `subscription/page.tsx`.
* **Why it's a real commercial gap, not vanity:** a merchant with 50,000 products needs ~25,000+ credits/month. Reaching that via \$0.30 top-ups is both punitively expensive and operationally absurd (dozens of manual purchases). Meanwhile the self-serve page implicitly tells a large buyer "you are not our customer", which is the wrong message at exactly the wrong moment.
* **Fix:** add a **"Contact Sales / Custom"** card with volume pricing and an admin-settable credit allotment, plus committed-use discounting. **Why a contact card rather than another price tier:** enterprise deals need negotiated terms (invoicing, procurement, SLA, DPA) that a checkout button cannot express — and a visible enterprise path signals you serve that segment.
* **Related:** enterprise custom limits are meaningless until **P0-5** is enforced. Fix enforcement first, then sell tiers.

---

## 17. Notifications & Background Job Inbox (`JobInbox`, `/api/notifications`)

### 🌟 Strengths
1. **Two clearly separated states** — live "In progress" runs with counts, and historical completed/failed/paused messages. Answering "is it still running?" and "what happened?" in one surface is exactly right.
2. **Deep links with read-on-click** — `openItem(href, id)` marks read then routes straight to the session. Notifications that lead to the work, not to a dashboard.
3. **Authorization enforced** — `✅ VERIFIED IN CODE` — `api/notifications/route.ts` checks `auth.getUser()` (17–22) then `getWorkspaceContext(...).membershipRole` (24–27), and scopes the query to `workspace_id` **and** `user_id` (33–34). Correct two-layer check: authenticated, member, and own rows only.

### Issue 17.1 — 15-Second Polling In Every Open Tab
* **Priority:** `P2` · **Effort:** `M` · **Blast Radius:** Cost · **Status:** 🟡 Partial
* **Evidence:** `✅ VERIFIED IN CODE` — `job-inbox.tsx` skips the interval when `document.visibilityState === "hidden"` and reloads on visible. Not migrated to Supabase Realtime.
* **Why it hurts:** each poll runs a `notifications` query **plus** `listActiveJobsForUser`. 20 members × 3 tabs × 240 polls/hour = **~14,400 request-pairs/hour**, ~99% returning no change. Cost scales with `seats × tabs`, not with activity — the worst possible scaling property. Polling also continues in background tabs where nobody can see the result.
* **Fix (in order of value):**
  1. **Pause when hidden** — `document.visibilityState` guard. Two lines, and it removes most of the waste immediately. Do this today even if the rest waits.
  2. **Supabase Realtime** — `postgres_changes` on `notifications` filtered by `user_id`. Updates arrive instantly *and* idle cost drops to a held socket. Event-driven beats polling whenever the transport already exists — and it does here.
  3. **Adaptive interval** — if polling must remain, back off from 15 s to 60 s after a few empty responses and reset on activity.

---

## 18. Product Identity — Consolidation On **Autommerce Platform**

### 📌 Scope Of The Problem
The product is now **Autommerce Platform**, served from **`platform.autommerce.com`**. Three earlier identities survive in the codebase, and one of them is not a branding issue at all — it is a live functional defect on customers' storefronts.

| Legacy identity | Where it still lives |
| :--- | :--- |
| **`DataSheet AI`** | Demo/auth screens, outbound HTTP `User-Agent` |
| **`Autommerce Data Entry`** | Page `<title>`, sidebar wordmark, auth layout, workspaces header |
| **`data-enrichment-ai.onrender.com`** | Hardcoded production origin in the storefront widget, snippet generator, and a **database cron migration** |
| **`data-sheet`** | `package.json` project name |

**Positive finding first:** `✅ VERIFIED IN CODE` — Autommerce branding is already applied across **~58 files**, including a proper design-system foundation (`src/lib/brand/tokens.ts`, `src/components/brand/autommerce-logo.tsx`, `src/lib/brand/README.md`, `--brand-font` in `globals.css`). The rebrand was done well and thoroughly. What remains is a **residue problem** in the specific places a UI-focused rebrand naturally misses: hardcoded URLs, HTTP headers, metadata, demo routes, and SQL.

---

### ⚠️ Why This Is A Real Finding, Not Cosmetic Polish

* **Priority:** `P1` overall — with the hardcoded-origin sub-issue at **`P0`** (see below) · **Effort:** `S` · **Blast Radius:** Availability / Trust / Brand · **Status:** ✅ Done

1. **The stale origin is a production outage waiting for a DNS change — this is the `P0` part.**
   `✅ VERIFIED IN CODE` — `https://data-enrichment-ai.onrender.com` is hardcoded as the fallback/default production origin in **four** places:

```18:18:public/widget.js
  var DEFAULT_PROD_API = "https://data-enrichment-ai.onrender.com";
```
```8:8:src/components/customize/snippet-block.tsx
const PRODUCTION_ORIGIN = "https://data-enrichment-ai.onrender.com";
```
   plus `src/lib/customize-widgets.ts:229,235` and — most dangerously — a committed database migration:

```20:20:supabase/migrations/20260821_growth_sync_cron.sql
  'https://data-enrichment-ai.onrender.com',  -- ← your deployed origin
```

   **Why this is severe rather than untidy:** `widget.js` and the generated snippet are **installed inside the merchant's live theme**. Every shopper pageview calls that origin (Issue 8.1). The moment the Render service is renamed, retired, or moved fully behind `platform.autommerce.com`, **every customer's storefront widget breaks simultaneously** — and you will not see it, because per **P0-9** there is no error tracking, and the failure happens in *their* browser, not your server. Worse, the snippet a merchant pasted six months ago is frozen; it does not update when you deploy. **A hardcoded third-party-embedded origin is effectively a permanent contract**, which is exactly why it must be a configured value resolved at request time, never a literal.
   The migration line is a second, quieter instance: the `pg_cron` job calling Growth Sync points at the old host, so a host change silently stops all scheduled classification with no error surface at all.

2. **The outbound `User-Agent` leaks a retired brand to third parties.**
   `✅ VERIFIED IN CODE` — `src/lib/gemini.ts:81,182` send `"Mozilla/5.0 (compatible; DataSheetAI/1.0)"` when fetching external pages. This header is recorded in the **server logs of every site you crawl**, including competitors and your own customers. A crawler identifying itself under a dead brand is unattributable — and an unattributable crawler is what gets IP-blocked. **Why this matters operationally:** a correct `User-Agent` with a contact URL is the standard way to *avoid* being blocked; an obsolete one guarantees nobody can whitelist you.

3. **`<title>` is the most-seen string in the product and it is stale.**
   `✅ VERIFIED IN CODE` — `src/app/layout.tsx:19` reads `"Autommerce Data Entry — Product Data Enrichment"`. This is the browser tab, the bookmark label, and the link preview title. The sidebar wordmark (`w/[workspaceSlug]/layout.tsx:444`), auth layout (`(auth)/layout.tsx:21`), header (`components/header.tsx:66`), and workspaces page (`workspaces/page.tsx:167`) all still render **"Data Entry"**.
   **Why the specific wording matters commercially:** "Data Entry" describes clerical work. The product being audited here does AI enrichment, visual generation, SEO research, and autonomous store classification. The name actively under-sells the thing you are asking \$2,500/month for — and it is the first words an enterprise buyer reads.

4. **Demo routes still show the oldest identity.**
   `✅ VERIFIED IN CODE` — `src/app/demo/login/page.tsx:38-39`, `demo/register/page.tsx:42`, `demo/layout.tsx:70` render **"DataSheet AI"** and "Product Data Enrichment Platform". Demo routes are typically what gets shown in a sales call or shared as a sandbox link, so they are *more* brand-sensitive than internal screens, not less. Note also that `src/lib/supabase-middleware.ts:49` exempts `/demo` from auth entirely — these pages are publicly reachable.

5. **Three identities in one repo defeats search.**
   A developer or AI agent looking for "the platform name" finds three answers and picks one. This is the same failure mode as Section 19's `import`/`sync` drift, and the same fix applies: **one constant, imported everywhere.**

---

### 🛠️ Migration Plan (ordered, with the reason for each step)

**Step 1 — `P0`: eliminate every hardcoded origin. Do this first and independently of the rest.**
Introduce a single resolved value — `NEXT_PUBLIC_APP_ORIGIN` (default `https://platform.autommerce.com`) — exposed through one helper (e.g. `getAppOrigin()`), and use it in `customize-widgets.ts`, `snippet-block.tsx`, and `widget.js`.
- For `widget.js`, **derive the origin from the executing script's own `src`** rather than a compiled constant. The file already inspects `document.currentScript`/script tags (`widget.js:28`), so the mechanism exists. **Why derivation beats configuration here:** the widget lives in someone else's HTML forever; a self-locating script keeps working through any future host change, whereas any baked value — old or new — will eventually be wrong again. Fix the *class* of bug, not this instance.
- Update the cron target in a **new** migration (`UPDATE`/re-create the `pg_cron` job), applied to **both** `local` and `deploy`. **Never edit `20260821_growth_sync_cron.sql` in place** — applied migrations are immutable history; editing one produces two databases that disagree about what has run.
- Keep the old Render hostname resolving (or `301` to the new origin) for as long as any previously-pasted snippet may exist in a merchant theme. **Why:** you cannot recall a snippet you already gave someone.

**Step 2 — Define the identity once.**
Add the canonical strings to the existing brand module (`src/lib/brand/tokens.ts` is already the right home): product name `"Autommerce"`, full name `"Autommerce Platform"`, tagline, and origin. Import them; stop writing the name as a literal in JSX. **Why reuse `brand/tokens.ts` rather than create a new file:** the brand system already exists and is well-structured — the defect is that these particular strings bypassed it. Adding a parallel constants file would recreate the drift.

**Step 3 — Replace `"Data Entry"` wording.**
Update `src/app/layout.tsx:19` metadata (title *and* description, plus OpenGraph if present), `w/[workspaceSlug]/layout.tsx:444`, `components/header.tsx:66`, `(auth)/layout.tsx:21`, `workspaces/page.tsx:167`. Suggested: **`Autommerce Platform`** with a subtitle reflecting current scope (e.g. *AI Commerce Operations*) rather than *Data Entry*. **Why change the descriptor and not just the wordmark:** the wordmark is recognition; the descriptor is positioning. Leaving "Data Entry" under a new logo preserves the exact misrepresentation this step exists to remove.

**Step 4 — Fix the crawler `User-Agent`.**
`src/lib/gemini.ts:81,182` → `"Mozilla/5.0 (compatible; AutommerceBot/1.0; +https://platform.autommerce.com/bot)"`. **Why include the URL:** it is the convention that lets a site owner identify and allow your traffic; a bare token gives them only the option to block.

**Step 5 — Rebrand or retire the demo routes.**
Decide explicitly: update them to Autommerce, or delete them. **Why an explicit decision:** unmaintained public pages under a dead brand are worse than no pages. If they exist as a sales sandbox, they must look current; if nobody uses them, they are dead code carrying an auth exemption (`supabase-middleware.ts:49`) — surface area with no owner.

**Step 6 — Housekeeping.**
`package.json` `name: "data-sheet"` → `"autommerce-platform"` (regenerate the lockfile). Update `README.md:1` (`# Data Enrichment AI`) and the email sender-name row at `README.md:123`. Sender name matters more than it appears: it is the "From" line on every invitation email, and a mismatch between the invite sender and the product looks like phishing to a corporate spam filter.

**Step 7 — Grep gate.**
Fail the check if any of `DataSheet`, `Data Entry`, `data-enrichment-ai`, `data-sheet` appear outside `package-lock.json` and historical migration files. **Why a gate rather than a one-time sweep:** the three identities coexisted for months precisely because nothing prevented reintroduction. Same guardrail principle as Section 19 — and the same Root Cause C.

---

### 🧭 Sequencing Note
Do Section 18 and Section 19 **in the same pass**. Both are string/identifier migrations touching overlapping files (`layout.tsx`, `labels.ts`, route folders, skill docs), both must precede **S-4** (audit logs) and **P0-9** (Sentry tagging) so telemetry is born with the final vocabulary, and both are cheapest during the disposable-data window. Splitting them doubles the review surface for no benefit.

---

## 19. Domain Vocabulary Consistency — Full Rename Of `import` ⟶ Catalog Intelligence And `sync` ⟶ Store Assistant

### 📌 Scope Of The Problem
Two modules were renamed **in the sidebar only**. The old internal vocabulary (`import`, `enrich`, `sync`) still surfaces in URLs, API paths, database identifiers, credit-ledger operation values, job labels, and storage/entity references.

Observed by the product owner:
- `"/w/abc/import"` and `"/w/abc/import/95eb3d1a-…/enrich"` are still the live URLs for **Catalog Intelligence**.
- Every credit deduction, job record, and log entry for **Store Assistant** is recorded as `sync` / `sync_agent`.

### ⚠️ Why This Is A Real Finding And Not Cosmetic Polish

This is normally dismissed as a naming nit. It is not, for five concrete reasons:

1. **The URL is customer-facing product surface.** An enterprise buyer sends a colleague a link to `/import/…/enrich` for a feature the UI calls *Catalog Intelligence*. The mismatch reads as an unfinished product, and it is the single most-shared artifact of the app — links outlive UI copy.
2. **The billing ledger is a legal-grade record.** `credit_transactions.operation = 'ai_enrichment'` and `'sync_agent'` appear in usage reports, per-operation breakdowns, and the CSV export requested in Issue 13.2. A finance team reconciling an invoice cannot map "Sync Agent" to a product called "Store Assistant". This is the same class of trust damage as Issue 13.1 — a billing surface that contradicts the product.
3. **Two vocabularies in one codebase is a permanent tax.** Every new developer, every future AI agent skill file, and every support conversation must translate `import ↔ Catalog Intelligence` and `sync ↔ Store Assistant`. Naming drift is how codebases become unmaintainable — not through bad algorithms but through accumulated translation overhead.
4. **The audit-log and observability work in this plan depends on it.** Finding S-4 (`security_audit_logs`) and P0-9 (Sentry tagging) will persist whatever identifiers exist at the time they are built. Instrumenting *before* renaming bakes the wrong vocabulary into immutable append-only records.
5. **The window to fix it cheaply is open right now and closes permanently.** Per the Environment Topology section, all data is disposable today. Renaming a credit-ledger operation value today is a `CHECK` constraint rewrite plus a re-seed. After the first customer it is either a lossy `UPDATE` on financial history or a permanent dual-vocabulary in every report. **This is the clearest example in the entire document of a fix whose cost multiplies by an order of magnitude on a known date.**

* **Priority:** `P1` — must land **before** S-4 (audit log), P0-9 (Sentry tagging), and Root Cause A's table migration, because all three will otherwise encode the old vocabulary permanently.
* **Effort:** `M`
* **Blast Radius:** UX / Trust / Maintainability
* **Status:** ✅ Done

---

### 🔍 Verified Rename Surface (inventory from source inspection)

#### A. Catalog Intelligence (currently `import` / `enrich`)

| Layer | Current identifier | Target | Notes |
| :--- | :--- | :--- | :--- |
| **Route folder** | `src/app/(dashboard)/w/[workspaceSlug]/import/**` (incl. `new/`, `[sessionId]/`, `[sessionId]/enrich/`) | `catalog-intelligence/**` | `✅ VERIFIED` — folder exists with these three children |
| **Live URL** | `/w/{slug}/import/{id}/enrich` | `/w/{slug}/catalog-intelligence/{id}` | **Decided (see Decision 1):** drop the `/enrich` leaf — it is a verb, it is a third nesting level, and it never varies |
| **Job deep-link builder** | `jobHref()` returns `/w/${slug}/import/${sessionId}/enrich` (`src/lib/jobs/href.ts:20`) | new path | `✅ VERIFIED` — single point of change; `href.test.ts` must be updated with it |
| **Job kind + label** | `JobKind = "catalog"`, label `"Catalog Intelligence"` (`href.ts:4`) | **already correct — do not change** | `✅ VERIFIED` — the kind is already `catalog`, so `job_runs.kind` needs no migration |
| **Admin job label** | `JOB_KIND_LABELS.catalog = "Catalog"` (`src/lib/platform-admin/labels.ts:46`) | `"Catalog Intelligence"` | `✅ VERIFIED` — inconsistent with `href.ts` today |
| **API routes** | `/api/import/{match,apply}`, `/api/enrich/{start,status,cancel}`, `/api/enrich` | `/api/catalog-intelligence/*` | `✅ VERIFIED` — both prefixes exist and are internal-only, so safe to rename |
| **Database table** | `import_sessions` (+ `20260826_import_session_kind.sql`, `remove_unused_import_sessions_columns.sql`) | `catalog_sessions` | `✅ VERIFIED` — referenced by `job_runs`, RLS policies, cascade deletes, and admin usage views |
| **Credit operation** | `credit_transactions.operation = 'ai_enrichment'` | `catalog_intelligence` | `✅ VERIFIED` — constrained by `credit_transactions_operation_check` (`20260811_sync_agent_credit_operation.sql:5`) |
| **Credit label** | `CREDIT_OPERATION_LABELS.ai_enrichment = "AI Enrichment"` (`labels.ts:14`) | `"Catalog Intelligence"` | `✅ VERIFIED` |
| **Storage path** | `${workspaceId}/projects/${sessionId}.json` (`storage-helpers.ts:107`) | **no change needed** | `✅ VERIFIED` — already domain-neutral. Leave it; renaming storage prefixes is pure risk with zero benefit |
| **Sidebar / catalog copy** | `layout.tsx`, `page.tsx`, `tools-catalog.ts`, `role-permissions.tsx` | already renamed | `✅ VERIFIED` — these are the only places already updated |

#### B. Store Assistant (currently `sync`)

| Layer | Current identifier | Target | Notes |
| :--- | :--- | :--- | :--- |
| **Route folder** | `src/app/(dashboard)/w/[workspaceSlug]/sync/**` | `store-assistant/**` | `✅ VERIFIED` |
| **Live URL** | `/w/{slug}/sync` | `/w/{slug}/store-assistant` | |
| **API routes** | `/api/sync/agent`, `/api/sync/load-shopify-products` | `/api/store-assistant/*` | `✅ VERIFIED` |
| **Credit operation** | `operation = 'sync_agent'` | `store_assistant` | `✅ VERIFIED` — in the same `CHECK` constraint |
| **Credit `entity_type`** | `entity_type = 'sync_agent'` | `store_assistant` | `✅ VERIFIED` — used by the historical relabel `UPDATE` in `20260811_*.sql:24-27` |
| **Credit label** | `CREDIT_OPERATION_LABELS.sync_agent = "Sync Agent"` (`labels.ts:19`) | `"Store Assistant"` | `✅ VERIFIED` |
| **Wallet module** | `WALLET_MODULE_LABELS.Sync = "Sync"` (`labels.ts:35`) and stored `module = 'Sync'` in `wallet_transactions` | `store-assistant` / `"Store Assistant"` | `✅ VERIFIED` — note the existing map already carries legacy duplicates (`"market-research"` **and** `"Market Research"`), which is evidence this drift is recurring |
| **Client store / components** | `src/store/sync-store.ts`, `src/components/sync/**`, `SyncSheet` type, `useSyncStore` | `store-assistant` equivalents | Internal only; rename with the compiler's help |
| **Provider libraries** | `src/lib/sync/providers/**` (shopify/woocommerce adapters) | **keep as `sync`** | Deliberate: these are genuinely *store synchronisation transport*, not the assistant feature. Renaming them would make the code less accurate, not more |

> **Note on the last row — this is the important judgement call.** Do **not** blanket-replace the string `sync` across the repo. `src/lib/sync/providers/**` implements real bidirectional store synchronisation and is shared by Growth Sync and Market Research push. The rename targets the **product feature** (`Store Assistant`), not the **technical capability** (`sync`). A mechanical find-and-replace would couple two unrelated concepts under one name and create a worse problem than the one being fixed.

---

### 🛠️ Migration Plan (ordered, with the reason for each step)

**Step 1 — Establish naming constants before touching anything.**
Define `CATALOG_INTELLIGENCE` / `STORE_ASSISTANT` identifiers in one module and import them everywhere. **Why first:** the root cause of this finding is that names were duplicated as literals across ~18 files. Renaming literals to different literals reproduces the bug with new spellings; centralising the identifier means the *next* rename is a one-line change.

**Step 2 — Database migration, applied to `local` and `deploy` in the same change.**
1. `ALTER TABLE import_sessions RENAME TO catalog_sessions;` and update every dependent RLS policy, cascade-delete rule, and admin usage view (`20260828_admin_workspace_usage.sql`).
2. Rewrite `credit_transactions_operation_check` with the new value set (`catalog_intelligence`, `store_assistant`), replacing `ai_enrichment` and `sync_agent`.
3. `UPDATE` existing rows to the new values, `entity_type` included.
4. Normalise `wallet_transactions.module` from `'Sync'` to `'store-assistant'`, and while there, collapse the legacy `"market-research"` / `"Market Research"` duplication.

**Why a hard rename with an `UPDATE` is acceptable *only now*:** it rewrites financial ledger rows. That is legitimate while every row is test data and is **prohibited** once a single real transaction exists. If this step is deferred past the first customer, the correct approach changes to *keep both values forever and map at the presentation layer* — permanent complexity. This step is the reason this finding is `P1` and not `P3`.

**Step 3 — Route and API renames with redirects.**
Move the folders, then add `permanent: false` (307) redirects in `next.config`. Per **Decision 1** the leaf is dropped, so the redirect must collapse the retired sibling views too: `/w/:slug/import/:id/(enrich|review|rules)` → `/w/:slug/catalog-intelligence/:id`, plus `/w/:slug/import/:path*` → `/w/:slug/catalog-intelligence/:path*` and `/w/:slug/sync` → `/w/:slug/store-assistant`. **Why temporary rather than permanent redirects:** a 301 is cached indefinitely by browsers and is effectively irreversible if the new path needs adjustment; use 307 for a release or two, then promote to 301 once settled. **Why redirects at all when there are no customers:** bookmarks, the product owner's own open tabs, and any in-app hardcoded link that the compiler cannot catch — the redirect is the safety net for exactly the references a rename misses.

**Step 4 — Update the single deep-link builder and its test.**
`jobHref()` (`src/lib/jobs/href.ts:20`) is the only place that constructs the session URL, and `href.test.ts` already covers it. **Why this is the highest-leverage file in the whole rename:** notification deep links, the job inbox, and progress toasts all flow through it — one correct change fixes every navigation entry point at once. Confirm the test asserts the new path so the rename cannot silently regress.

**Step 5 — Align labels.**
Set `JOB_KIND_LABELS.catalog = "Catalog Intelligence"` (currently `"Catalog"`, inconsistent with `href.ts`), `CREDIT_OPERATION_LABELS` to the new keys, and `WALLET_MODULE_LABELS` accordingly. **Why labels come after data:** labels are the display of the identifier; changing them first produces a UI that lies about what is stored, which is precisely the state this finding exists to eliminate.

**Step 6 — Verify with the compiler and a grep gate.**
Run `npm run typecheck` and `npm run test`, then grep for the retired identifiers (`ai_enrichment`, `sync_agent`, `import_sessions`, `/import/`, `'Sync'`) and confirm the only remaining matches are the intentional exclusions (`src/lib/sync/providers/**`, historical migration files, which must never be edited retroactively). **Why a grep gate and not just a green build:** TypeScript cannot see string literals in SQL, in URLs, or in agent skill markdown — and those are exactly where this drift originated.

**Step 7 — Update the skill and documentation files.**
`.cursor/skills/import-enrichment-openai/SKILL.md` and `sync-pro-openai-web/SKILL.md` describe these modules by their old names and paths. **Why this matters more than normal docs:** these files are instructions consumed by AI agents editing this codebase. Stale paths in a skill file cause an agent to confidently edit the wrong module — documentation drift with write access.

---

### 🧭 Guardrail To Prevent Recurrence
Add a naming decision to the project rules: **a user-visible module rename is not complete until the route, the API path, the DB identifier, the ledger operation value, the label map, and the skill file all agree.** The existing `WALLET_MODULE_LABELS` entry that carries both `"market-research"` and `"Market Research"` is proof this has already happened twice; without a written rule it will happen a third time.

---

## 📊 Master Remediation Matrix

| Module | Root Cause | Key Finding | Priority | Effort | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0. Platform Security** | C | Public endpoint reads all tenants' plaintext credentials | **P0** | S | ✅ |
| **0. Platform Security** | C | Substring tenant matching → cross-tenant leak | **P0** | S | ✅ |
| **0. Platform** | C | Plan limits are dead code | **P0** | M | ✅ |
| **0. Platform** | A | No Storage backup (customer data unprotected) | **P0** | S | 🟡 |
| **0. Platform** | — | No error tracking / alerting | **P0** | S | 🟡 |
| **0. Platform** | — | Vulnerable `xlsx@0.18.5` parsing untrusted files | P1 | S | ✅ |
| **0. Platform** | C | No security audit log | P1 | M | ✅ |
| **0. Platform** | — | Tenant purge deletes the owning row before verifying Storage → permanent orphans | P1 | M | ✅ |
| **0. Platform** | — | No RLS policy predicate has been proven tenant-scoped | P1 | M | ✅ |
| **0. Platform** | — | Middleware `getSession()` not cryptographically verified | P2 | S | ✅ |
| **0. Platform** | — | Timing-unsafe cron secret comparison | P3 | S | ✅ |
| **1. Products** | A | Full catalog downloaded to browser | P1 | L | ✅ |
| **1. Products** | A | Delete rewrites whole catalog → lost updates | P1 | M | ✅ |
| **1. Products** | — | Excel images inlined as Base64 | P1 | M | ✅ |
| **1. Products** | A | Unthrottled per-keystroke search | P1 | S | ✅ |
| **1. Products** | A | Column extraction scans dataset | P2 | S | ✅ |
| **2. Categories** | C | Name-only import collapses distinct branches | P1 | M | ✅ |
| **2. Categories** | — | Recursive DOM tree, no virtualization | P2 | M | ✅ |
| **2. Categories** | A | Hardcoded `productCount: 0` | P2 | M | ✅ |
| **2. Categories** | A | No optimistic locking on taxonomy save | P2 | M | ✅ |
| **2. Categories** | — | `isDescendant` rescan per `dragOver` | P3 | S | ✅ |
| **3. Enrichment** | A+B | Full blob write per row (150–400 GB/run) | **P0** | M | ✅ |
| **3. Enrichment** | A | Apply has no concurrency control → data loss | **P0** | M | ✅ |
| **3. Enrichment** | A | Match types recomputed on every load | P2 | S | ✅ |
| **3. Enrichment** | — | Unbounded undo stack | P2 | S | ✅ |
| **3. Enrichment** | — | Virtualization measurement cost | P3 | S | 🟡 |
| **4. Image Classify** | — | Unbounded `Promise.all` over image downloads | P1 | M | ✅ |
| **4. Image Classify** | C | 200-image cap blocks enterprise archives | P2 | L | ❌ |
| **4. Image Classify** | — | No resumable / ZIP upload | P2 | M | ❌ |
| **4. Image Classify** | — | Fake progress bar | P3 | S | ✅ |
| **5. Gallery** | A | Signs all image URLs every 750 ms | **P0** | M | ✅ |
| **5. Gallery** | B | Double worksheet write per row | P1 | M | ✅ |
| **5. Gallery** | — | Serial signed-URL resolution in export | P2 | S | ✅ |
| **6. Visualizer** | — | 32 implicit concurrent image API calls | P1 | M | ✅ |
| **6. Visualizer** | B | Triple worksheet write per row | P1 | M | ✅ |
| **6. Visualizer** | — | Brand assets re-downloaded per row | P2 | S | ✅ |
| **7. Market Research** | — | Re-tokenization in \(O(K \times P)\) loop | P1 | M | ✅ |
| **7. Market Research** | — | Sequential AI batches (150 s) | P1 | S | ✅ |
| **7. Market Research** | — | Unthrottled push to store APIs | P1 | M | ✅ |
| **7. Market Research** | — | Full collection catalog in prompt | P2 | M | ✅ |
| **8. Embed / Widgets** | A | Storage slice reads on every shopper pageview | P1 | M | ✅ |
| **8. Embed / Widgets** | C | Substring tenant matching → cross-tenant leak | **P0** | S | ✅ |
| **8. Embed / Widgets** | C | Public endpoint reads all tenants' plaintext credentials | **P0** | S | ✅ |
| **9. Growth Sync** | — | All collections in every prompt | P2 | M | ✅ |
| **9. Growth Sync** | — | Synchronous cron tick caps throughput | P2 | L | 🟡 |
| **10. Wallet** | A | Full ledger to client, in-memory pagination | P1 | M | ✅ |
| **10. Wallet** | — | `remaining / total` badge misleading | P3 | S | ✅ |
| **11. Website Restructure** | — | Unscaled screenshots (~100 MB requests) | P2 | S | ✅ |
| **11. Website Restructure** | — | Lease not reclaimable by owner | P3 | S | ✅ |
| **12. Store Assistant** | — | Full sheet snapshots in undo stack | P1 | M | ✅ |
| **12. Store Assistant** | B | No checkpoint on long AI batch runs | P1 | M | ✅ |
| **13. Usage** | A | "All-time" computed from 200 rows | P1 | S | ✅ |
| **13. Usage** | — | No date filter / CSV export | P2 | S | ✅ |
| **14. Team** | C | No audit log on role changes | P1 | M | ✅ |
| **14. Team** | — | Unpaginated member list | P3 | S | ✅ |
| **15. Settings** | C | Plaintext store API tokens | **P0** | M | ✅ |
| **16. Subscription** | — | No enterprise tier | P2 | M | ⛔ |
| **17. Notifications** | — | 15 s polling per tab | P2 | M | 🟡 |
| **18. Identity** | C | Old Render origin hardcoded in storefront widget + cron migration | **P0** | S | ✅ |
| **18. Identity** | C | `<title>` / sidebar still "Autommerce Data Entry" | P1 | S | ✅ |
| **18. Identity** | C | Crawler `User-Agent` still `DataSheetAI/1.0` | P2 | S | ✅ |
| **18. Identity** | C | Demo routes still branded "DataSheet AI" (publicly reachable) | P2 | S | ✅ |
| **19. Naming** | C | `import`/`enrich` still in URLs, DB, ledger for **Catalog Intelligence** | P1 | M | ✅ |
| **19. Naming** | C | `sync`/`sync_agent` still in URLs, DB, ledger for **Store Assistant** | P1 | M | ✅ |
| **19. Naming** | C | `JOB_KIND_LABELS.catalog = "Catalog"` contradicts `href.ts` | P3 | S | ✅ |
| **0. Platform** | — | `local` and `deploy` schemas must not drift; migrate both together | P1 | S | ✅ |

---

## 🗺️ Suggested Execution Sequence

**Week 1 — Stop the bleeding (all `S`, highest consequence):**
Delete embed Pass 2 (P0-2) → scope the embed query and stop selecting `config` (P0-1) → replace every hardcoded `data-enrichment-ai.onrender.com` origin, make `widget.js` self-locating, and repoint the cron job (P0-10) → install Sentry with credential scrubbing (P0-9) → enable Storage backup + restore drill (P0-6) → add the search debounce (1.2) and the visibility guard on polling (17.1). *Rationale: closes both security findings, removes a latent storefront-wide outage, and buys production visibility before touching anything structural.*

**Weeks 2–3 — Stop the cost and data-loss bleeding:**
Checkpointed persistence in all three workers (3.1, 5.2, 6.2) → concurrency control on catalog apply (3.5) → slim gallery progress endpoint (5.1) → enforce plan limits and upload guardrails at API boundaries (P0-5). *Rationale: these are the findings that either bankrupt the quota or silently destroy customer work.*

**Weeks 2–3 addition — prove the safety net:**
Run the `pg_policies` diff and the two-tenant negative tests (S-6), and fix the tenant-purge ordering (S-5). *Rationale: both are `M` effort, both are cheapest while the databases are seedable and disposable, and S-6 in particular validates an assumption that several severity ratings in this document depend on.*

**Week 4 — Irreversible-later work, while all data is still disposable:**
Complete the Section 18 identity consolidation (Autommerce Platform) **and** the Section 19 rename in both databases (`import` → Catalog Intelligence, `sync` → Store Assistant, including the credit-ledger `operation` and `entity_type` values) → encrypt integration credentials with a rotation path (P0-7) → then `security_audit_logs` (S-4) → replace `xlsx` (S-2) → JWT verification in middleware (S-1).
*Rationale and ordering constraint: the rename **must** precede S-4 and P0-9's tagging, because append-only audit logs and error telemetry permanently encode whatever identifiers exist when they are built. It must also precede the first customer, after which rewriting ledger rows becomes prohibited and the only remaining option is a permanent dual-vocabulary.*

**Week 4 landed (2026-09-01):** identity tokens + grep gate; Catalog Intelligence / Store Assistant routes and APIs with 307 redirects from the old paths; `import_sessions` → `catalog_sessions` and ledger `ai_enrichment` → `catalog_intelligence`, `sync_agent` → `store_assistant`. Wallet module `'Sync'` was **Growth Sync**, not Store Assistant — mapped to `growth-sync` (not `store-assistant`) so the two products stay distinct. Review and rules remain `/catalog-intelligence/{id}/review` and `/rules` (live wizard steps). AES-256-GCM envelopes with `active`/`previous` key slots and lazy re-encrypt; append-only `security_audit_logs`; `xlsx` removed in favour of ExcelJS; middleware verifies HS256 locally. Production still needs `INTEGRATION_ENCRYPTION_KEY` and `SUPABASE_JWT_SECRET` in the host env (not committed).

**Weeks 5–8 — Root Cause A, incrementally:**
Postgres row tables with dual-write → backfill → migrate `/products` first, then Catalog Intelligence, gallery, visualizer, wallet ledger. *Rationale: each migrated module retires several rows of the matrix above; sequencing it last means it lands on a codebase that is already observable, safe, and correctly named — so the new tables are created with the final vocabulary and never need renaming.*

**Week 5 landed (2026-09-01):** `workspace_products` + column manifest, dual-write with `products.json`, lazy blob backfill, `GET /api/products` keyset pagination and server search, `DELETE /api/products` and `POST /api/products/import` so the browser no longer downloads or rewrite-saves the full catalog. Blob writes stay until Catalog Intelligence / gallery / visualizer / wallet readers migrate (Weeks 6–8). Rollback: `PRODUCTS_ROW_STORE=0`. Issue 1.5 (inline Base64 images) is not in this slice.

**Week 6 landed (2026-09-01):** `catalog_session_rows` dual-write with `projects/{sessionId}.json`; enrich hot path is a per-row `UPDATE` (Issue 3.1 Root Cause A for Catalog Intelligence); reads hydrate from the table with lazy backfill; apply/match read `workspace_products` when the products store is on; match types are not recomputed on enrich load once persisted (3.2); undo capped at 30 (3.3). Blobs stay for gallery/visualizer/wallet (Weeks 7–8). Rollback: `CATALOG_ROW_STORE=0`.

**Week 7 landed (2026-09-01):** `gallery_session_rows` PK `(session_id, row_id)` on both DBs, RLS member SELECT, prune RPC `delete_gallery_session_rows_except`. Dual-write blob + rows in `storage-admin`; hot path `upsertWorksheetRow` in the gallery worker. Flag: `GALLERY_ROW_STORE` (rollback `=0`). Export signing uses `mapLimit(20)` (5.3).

**Week 8 landed (2026-09-01):** `visualizer_session_rows` + prune RPC, `embed_page_cache` PK lookup/upsert with Cache-Control (8.1), `credit_usage_totals` / `wallet_spend_summaries` RPCs. Dual-write + hot row patch for visualizer. Wallet transactions keyset pagination (10.1). Flag: `VISUALIZER_ROW_STORE` (rollback `=0`). Blobs are not dropped.

**Leftovers landed (2026-09-01):** categories virtualization, path-keyed import, `category_product_counts`, optimistic taxonomy revision (2.1–2.5); Excel embedded images uploaded as `vz-storage:` not data URLs (1.5); image-classify `mapLimit(6)` downloads (4.2) and honest progress (4.4); visualizer `IMAGE_PARALLEL = 1` + `withAiSlot` (6.1) and brand-asset cache (6.3); Market Research term index, parallel stage-4 batches, Stage-1 top-150 collections, Shopify-throttled push (7.1–7.4); Growth Sync candidate cap (9.1) and tick `after()` enqueue (9.2 partial); credits badge (10.2); WR screenshot downscale + owner lease reclaim (11.1–11.2); Store Assistant cell-patch undo + 20-row checkpoint (12.1–12.2); usage all-time RPC + date/CSV (13.1–13.2); team 15/page search (14.1); cron `timingSafeEqual` (S-3). Migration `20260901_leftovers_counts_wr_lease.sql` on both DBs. Visualizer slim `/progress` poll (same pattern as gallery). Gallery/visualizer session create enforces `assertJobRowQuota` against `max_products_per_workspace`. Integration save requires `INTEGRATION_ENCRYPTION_KEY` in every environment (no plaintext fallback).

**Still open (ops / first real customer only):** Storage backup drill (P0-6), host env `INTEGRATION_ENCRYPTION_KEY` + `SUPABASE_JWT_SECRET` (not in git).

**Out of scope:** enterprise tier (16.1), CLIP/200-cap (4.1), ZIP upload (4.3), Growth Sync worker pool (9.2 remainder), Realtime inbox (17.1 remainder), catalog grid measurement (3.4), load/email/Stripe/onboarding/VPAT/mobile (Deferred table).

**Ongoing:** keep dual-write until a later blob-drop decision; do not start a numbered week past 8.

---

## 📋 Deferred Scope — With Explicit Triggers

Per **Decision 2**, two of the original eight gaps were audited and promoted into the plan; the remaining six are deferred **deliberately**, each tied to an event rather than a date.

| Gap | Status | Trigger |
| :--- | :--- | :--- |
| **Tenant deletion / GDPR erasure** | ✅ **Audited** → Finding **S-5** (`P1`) | — |
| **RLS policy correctness** | ✅ **Audited** → Finding **S-6** (`P1`) | — |
| **Load / soak testing** | Deferred by **Decision 3** | After the Root Cause A migration, before the first enterprise onboarding |
| **Email deliverability** (SPF/DKIM, bounces) | Deferred | Before the first invitation is sent to a customer's domain |
| **Stripe edge cases** (dunning, proration, refunds, downgrade credits) | Deferred | Before the first real paid subscription |
| **Onboarding / first-run flow** | Deferred | Before the first customer self-serves without the owner watching |
| **Accessibility** (keyboard, focus, screen readers) | Deferred | On the first procurement / VPAT request |
| **Mobile / small-viewport data grids** | Deferred | On evidence of real mobile usage |

**Why this table replaced a flat list:** an undifferentiated "not audited" list is indistinguishable from a list of things you forgot. Naming the trigger converts each line from an open worry into a scheduled decision — and makes it impossible to pass the trigger without noticing.

---

*Prepared as an enterprise production-readiness assessment. Every `✅ VERIFIED IN CODE` claim was confirmed by direct source inspection; items marked `⚠️ ASSUMED` require confirmation before being acted on. Update the `Status` column as work lands so this document stays a plan rather than becoming a report.*
