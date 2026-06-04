# Sync Agent Redesign 2026 — v2 (Verified Against Shopify Admin API 2026-04)

> **Status**: This plan supersedes v1. All Shopify API claims have been verified against official docs (https://shopify.dev) on 2026-05-03. All filter syntax, mutation shapes, and rate-limit numbers below are confirmed.

---

## Section 0 — What Changed From v1 (And Why)

| # | v1 Claim | Truth From Shopify Docs | v2 Resolution |
|---|----------|------------------------|---------------|
| 1 | `query: "image_status:missing"` | Filter does **not** exist. Valid product filters: `title, barcode, bundles, category_id, collection_id, created_at, delivery_profile_id, gift_card, handle, has_only_composites, has_only_default_variant, has_variant_with_components, id, inventory_total, is_price_reduced, metafields.{ns}.{key}, out_of_stock_somewhere, price, product_configuration_owner, product_publication_status, product_type, published_status, sku, status, tag, updated_at, variants.price, vendor` | Use **hybrid filtering**: API filters for what Shopify supports, client-side post-filter for the rest (image-presence, content length, SEO emptiness). |
| 2 | `query: "collection:'Summer'"` | Only `collection_id:<numeric>` is supported. | **Two-step resolution**: query `collections(query:"title:Summer")` → take first ID → query `products(query:"collection_id:<id>")`. |
| 3 | "25 products per request, concurrency:3, delay:1000ms" | `productSet` is single-product. For >25 items, the right tool is `bulkOperationRunMutation` (no rate limit, async, 5 concurrent per shop, 100MB JSONL, 24h timeout). | **Two paths**: ≤ N items → loop `productSet` synchronously with cost-aware concurrency; > N items → `bulkOperationRunMutation` with `stagedUploadsCreate` + JSONL. |
| 4 | Static GraphQL introspection on first connect | Schema is large + costs points + Shopify schema is stable. | Drop introspection. Maintain a **typed field catalog** in `src/lib/sync/providers/shopify/schema-catalog.ts` updated per API version. |
| 5 | `useGraphQL2026` feature flag + 30-day REST fallback | Adds permanent dual-code maintenance. GraphQL Admin is GA and required for new product features. | **Hard cutover** to GraphQL. Keep REST helpers only for `shop.json` connection test (one endpoint). |
| 6 | Hard cap: "3 products per request" | Same cap for cheap and expensive ops is wrong. | **Operation-aware caps** decided by the agent: read=∞, light-write=25, medium-write=10, heavy-AI-write=3, apply-to-shopify=∞ (uses bulk mutation when >25). |
| 7 | Agent fully decides confirmation | Prompt-injection risk on user data. | **Three-tier policy**: hard allowlist (auto), hard denylist (always confirm), grey zone (agent decides with row-count cap). |
| 8 | Post-apply ReAct = re-query Shopify | Race condition + cost. | Use `userErrors` + returned `product` from `productSet` response itself. Re-query only on error. |
| 9 | "concurrency:2, delayMs:550" for REST apply | GraphQL uses **calculated cost**, not request count. | **Cost-aware throttler**: read `extensions.cost.throttleStatus.currentlyAvailable` after each call, sleep if below threshold; respect `Retry-After` on `THROTTLED`. |
| 10 | No idempotency mentioned | `productSet` supports `identifier.customId` (namespace/key/value metafield) or `identifier.handle` for upsert. **Known bug**: customId upsert + metafields fails together; handle-based upsert works. (Source: Shopify community 2025) | Use `handle` as upsert identifier; reserve `customId` for future when bug is fixed. |

---

## Section 1 — Verified Shopify Constraints (2026-04)

These numbers are facts from `shopify.dev`:

- **API version**: `2026-04` is `latest`. `2026-07` is release candidate. We pin to `2026-04`.
- **Single GraphQL query cost**: max **1,000 points** (pre-execution check). `Shopify-GraphQL-Cost-Debug=1` returns per-field breakdown.
- **Input array max**: **250** items per array argument.
- **Bulk query operations**: up to **5 concurrent** per shop in 2026-01+ (was 1).
- **Bulk mutation operations**: up to **5 concurrent** per shop in 2026-01+, JSONL ≤ **100 MB**, must finish within **24 hours**, mutation passed in is limited to **one connection field**, no rate limit on bulk itself.
- **Bulk mutation = recommended path** for any large write (Shopify's own docs).
- **Recommended throttle backoff**: **1 second** as starting backoff.
- **`productSet` complexity costs** (per Shopify docs): `metafields` 0.4 each, `files` 1.9 each. Variants/options also have costs.
- **`productSet` upsert identifiers**: `{ handle: "..." }` or `{ customId: { namespace, key, value } }`. **Known issue**: customId + metafields together can fail; prefer handle.
- **Async `productSet`**: returns `ProductSetOperation`; poll with `productOperation(id:)`.
- **`ProductSetInput` fields** (verified): `category, claimOwnership, collections ([ID!]), combinedListingRole, descriptionHtml, files, giftCard, giftCardTemplateSuffix, handle, metafields, productOptions, productType, redirectNewHandle, requiresSellingPlan, seo (SEOInput), status, tags, templateSuffix, title, variants, vendor`. (`id` field is deprecated; use identifier instead.)

---

## Section 2 — Core Philosophy

The agent is a **hierarchical supervisor** that owns every decision:

1. **Plan**: classify intent → choose strategy → choose scope cap → pick column profile → build server-side filter → mark confirmation requirement.
2. **Execute**: run typed tools with strict input/output validation; stream progress.
3. **Reflect**: after each step, evaluate `userErrors`, throttle status, and partial results; decide whether to retry, narrow, or stop.
4. **Remember**: persist `lastFilter`, `cursor`, `remainingCount`, `columnProfile`, `lastTargetIds` so "continue", "more", "do the same for…" work without re-planning.

The UI is a **dumb terminal**: it renders whatever `columnProfile` and `requiresConfirmation` the agent emits.

---

## Section 3 — Agent Architecture (Hierarchical Plan-Execute-Reflect)

```
┌─────────────────────────────────────────────────────────────┐
│  Supervisor Planner  (Gemini 2.5, JSON schema-constrained)  │
│  Inputs:  user msg + chat history + sheet snapshot          │
│           + working memory + integration meta                │
│  Outputs: { strategy, scopeCap, columnProfile, filter,      │
│             steps[], requiresConfirmation, costEstimate }   │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Worker Pool (typed tool contracts, Zod-validated)          │
│  • Fetcher    — server-side GQL filter or bulkOpQuery       │
│  • Filter     — client-side post-filter (image-presence...) │
│  • Writer     — AI column generation, batched per scope cap │
│  • Applier    — productSet sync OR bulkOpMutation           │
│  • Researcher — web search w/ grounding                     │
│  • Collector  — collections fetch / create / assign         │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Reflector — examines userErrors, throttle, partial counts  │
│  Decides: retry / narrow / split-batch / stop / ask-user    │
└─────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│  Tracer — writes one row per agent run + per tool call to   │
│  sync_agent_traces (Supabase) for debug + eval              │
└─────────────────────────────────────────────────────────────┘
```

---

## Section 4 — Operation-Aware Scope Caps

The agent picks `scopeCap` per plan based on operation class. Defaults (overridable by explicit user request):

| Class | Examples | Default cap |
|-------|----------|-------------|
| `read` | load, filter, count, view collections, web research | **∞** (paginated) |
| `light_write` | tag toggle, status change, price set, vendor rename | **25** |
| `medium_write` | seo_title, handle, alt-text, short translation | **10** |
| `heavy_ai_write` | body_html, long description, multi-language full text, image search per row | **3** |
| `delete` | column delete, product delete | **3** + always confirm |
| `apply_to_shopify` | push pending changes to store | **∞** (uses bulk mutation when >25) |

Scope cap is decided in the planner LLM prompt and validated server-side; the LLM cannot raise the cap above the class default unless the user message **explicitly** says "all", "everything", "without limit", and even then heavy_ai_write tops out at **25** to protect token budget.

---

## Section 5 — Hybrid Filtering Strategy

### 5.1 Server-Side Filter Builder (`buildShopifyProductsQuery`)

Maps high-level intent → Shopify search-syntax string. Only uses verified filters:

```typescript
type ShopifyServerFilter = {
  status?: "ACTIVE" | "ARCHIVED" | "DRAFT";
  vendor?: string;
  productType?: string;
  tag?: string | string[];          // joined with AND
  collectionId?: string;            // resolved upstream from name
  priceRange?: { min?: number; max?: number };
  inventoryRange?: { min?: number; max?: number };
  outOfStockSomewhere?: boolean;
  isPriceReduced?: boolean;
  giftCard?: boolean;
  createdAfter?: string;            // ISO
  updatedAfter?: string;
  metafield?: { namespace: string; key: string; value: string };
  freeText?: string;                // searches title etc.
};
```

### 5.2 Client-Side Post-Filter (`applyClientSidePredicates`)

For things Shopify cannot filter:

```typescript
type ClientPredicate =
  | { kind: "missing_image" }
  | { kind: "image_count_lt"; n: number }
  | { kind: "description_shorter_than"; chars: number }
  | { kind: "missing_seo_title" }
  | { kind: "missing_seo_description" }
  | { kind: "missing_alt_text" }
  | { kind: "title_matches"; regex: string }
  | { kind: "no_collections" };
```

Strategy: server-side filter narrows the candidate set (e.g. `status:active` → 8k items), then we fetch via bulk operation, then apply client predicates locally.

### 5.3 Collection Name → ID Resolver

Two-step always:

```graphql
query ResolveCollection($q: String!) {
  collections(first: 5, query: $q) {
    edges { node { id title handle } }
  }
}
```

Cache result in `SyncWorkingMemory.collectionsByName` (TTL: session).

---

## Section 6 — Cost-Aware Throttling

GraphQL Admin uses calculated query cost, not request count. We respect this.

### 6.1 `ShopifyGraphQLClient` (new)

```typescript
class ShopifyGraphQLClient {
  // Sends a query, parses extensions.cost, sleeps if bucket near empty.
  async request<T>(query: string, vars: object, opts?: { tag?: string }): Promise<T>;

  // Internal state
  private bucketAvailable: number = 2000;
  private restoreRate: number = 100;  // points/sec, updated from extensions

  // After each response:
  //   read extensions.cost.throttleStatus.currentlyAvailable
  //   if available < REQUESTED_NEXT_COST → sleep((REQUESTED - available)/restoreRate * 1000)
  //   on THROTTLED error → exponential backoff 1s → 2s → 4s → 8s (max 5 tries)
}
```

### 6.2 Cost Estimator (planner side)

Before submitting a query, estimate: `first × (sum of selected field costs)`. If estimate > 800, agent is forced to:
- split into smaller pages, **or**
- promote to bulk operation (no cost limit).

For mutations, sum: 10 base + 0.4 × metafields + 1.9 × files + variant costs.

---

## Section 7 — Apply Strategy: Two-Path Writer

### 7.1 Decision Tree

```
pendingChanges.length
  ≤ 25 → loop productSet synchronously with cost-aware throttling
  > 25 → bulkOperationRunMutation:
           1. stagedUploadsCreate → get URL + parameters
           2. Upload JSONL of {input: ProductSetInput, identifier} per line
           3. bulkOperationRunMutation(mutation: "productSet(...) {...}", stagedUploadPath: ...)
           4. Subscribe webhook OR poll bulkOperation(id:) every 5s
           5. Download result JSONL, parse userErrors, surface to user
```

### 7.2 Idempotency

Use `identifier: { handle: row.handle }`. Handle is unique per product in Shopify. This makes retries safe. (We avoid `customId` due to known metafields-with-customId bug noted in Shopify community 2025.)

### 7.3 Concurrency Control (per workspace)

Acquire a Postgres advisory lock keyed by `workspace_id` for the duration of an apply. Prevents concurrent applies from same workspace clobbering each other.

```sql
SELECT pg_try_advisory_xact_lock(hashtext('sync_apply:' || $workspace_id));
```

If lock fails → return 409 with "Another sync is in progress, try again in a moment".

---

## Section 8 — Dynamic Column Profiles

### 8.1 Profile Catalog (server-side, agent-known)

```typescript
const COLUMN_PROFILES = {
  core:              ["title","status","vendor","product_type","price","inventory_total"],
  pricing:           ["title","price","compare_at_price","cost","margin","status"],
  seo:               ["title","handle","seo_title","seo_description"],
  content:           ["title","body_html","seo_title","seo_description","tags"],
  imagery:           ["title","featured_image","image_alt_text","image_count"],
  inventory:         ["title","primary_sku","inventory_total","variant_count","status"],
  collections:       ["title","collections","product_type","tags","status"],
  publishing:        ["title","handle","status","published_at","updated_at","created_at"],
  taxonomy:          ["title","category","product_type","tags","vendor"],
  translations:      ["title","handle","body_html"], // + dynamic *_<lang> columns
  variants:          ["title","variant_count","primary_sku","price","inventory_total"],
  metafields:        ["title", /* dynamic metafields_* */],
  all:               [], // empty = render every key in row
} as const;
```

### 8.2 Dynamic Column Discovery

When the AI writes a new column (e.g. `description_french`), it gets added to the row keyset; the profile `translations` includes any `*_<lang>` suffix at render time.

### 8.3 UI Rendering

`SHEET_VIEWS` is **deleted**. The page reads `currentColumnProfile` from store and either:
- maps it through `COLUMN_PROFILES` to get the column list, or
- if profile is `all`, renders every column present in `sheet.columns`.

Custom AI-generated columns (translations, metafields_*) are appended to the rendered list.

---

## Section 9 — Working Memory v2

```typescript
type SyncWorkingMemoryV2 = {
  // From v1
  lastTargetedRowIndexes: number[];
  lastCreatedRowIndexes: number[];
  lastResearchSummary?: string;

  // New for v2
  lastServerFilter?: ShopifyServerFilter;
  lastClientPredicates?: ClientPredicate[];
  lastCursor?: string;                    // GQL endCursor of last page
  lastBulkOperationId?: string;           // when paginating bulk ops
  remainingCount?: number;                // total minus processed
  totalMatchCount?: number;
  lastColumnProfile?: keyof typeof COLUMN_PROFILES;
  collectionsByName?: Record<string, { id: string; handle: string }>;
  lastApplyStats?: { created: number; updated: number; failed: number };
  lastErrorRows?: Array<{ rowIndex: number; reason: string }>;
};
```

When user says "continue", "more", "the rest", "البقية", agent reads memory, runs same filter from `lastCursor` with the **same `scopeCap`**, and increments processed.

---

## Section 10 — Confirmation Policy (Three-Tier)

| Tier | Tools | Behavior |
|------|-------|----------|
| **Allowlist (auto)** | `load_products`, `load_collections`, `run_sheet_program`, `answer_question_about_sheet`, `research_with_web`, `analyze_attachments`, `reply_only` | Always auto-execute |
| **Denylist (always confirm)** | `apply_to_shopify`, `delete_column`, `delete_product`, `bulk_apply` | Always show confirmation dialog, regardless of agent flag |
| **Grey zone (agent decides + cap)** | `write_sheet_column_with_ai`, `search_images_with_serper`, `append_row_from_ai`, `assign_to_collection`, `create_collection` | Auto-execute if `scopeCap ≤ 3` AND agent flagged `requiresConfirmation:false`; otherwise show preview |

Hard limits: heavy_ai_write tools always cap at 25 even if user says "all". User can re-issue "continue" to process the next batch.

---

## Section 11 — Tool Catalog (v2)

All tools have **typed input schema (Zod)** and structured output. The LLM sees their schemas via Gemini's responseJsonSchema; the runtime validates inputs before execution.

| Tool | Class | Input | Output |
|------|-------|-------|--------|
| `load_products` | read | `{ filter: ShopifyServerFilter, predicates?: ClientPredicate[], limit?: number, cursor?: string, columnProfile: ProfileKey }` | `{ sheet, cursor, totalEstimate, columnProfile }` |
| `load_collections` | read | `{ query?: string, limit?: number }` | `{ sheet, count }` |
| `resolve_collection_id` | read | `{ name: string }` | `{ id, handle, title }` or `null` |
| `run_sheet_program` | read | `{ instruction, goal: "answer"|"show_filtered"|"target_rows" }` | `{ sheet, rowIndexes, summary }` |
| `answer_question_about_sheet` | read | `{ instruction }` | `{ message }` |
| `research_with_web` | read | `{ instruction }` | `{ summary, sources }` |
| `analyze_attachments` | read | `{ instruction }` | `{ summary }` |
| `write_sheet_column_with_ai` | grey | `{ targetColumn, instruction, overwrite, rowIndexes, scopeCap }` | `{ values: [{rowIndex,value}], processedCount }` |
| `search_images_with_serper` | grey | `{ targetColumn, instruction, overwrite, rowIndexes, scopeCap }` | same |
| `append_row_from_ai` | grey | `{ instruction }` | `{ rowIndex, row }` |
| `assign_to_collection` | grey | `{ collectionId, rowIndexes }` | `{ assigned }` |
| `create_collection` | grey | `{ title, type: "manual"\|"smart", rules?, description? }` | `{ id, handle }` |
| `delete_column` | deny | `{ column }` | `{ ok }` |
| `apply_to_shopify` | deny | `{}` (uses pending diff) | `{ created, updated, failed, errors }` |
| `reply_only` | allow | `{ message }` | `{}` |

Tools removed from v1 catalog: `load_products_from_shopify`, `load_products_from_woocommerce` (collapsed into `load_products` — provider routing happens in the registry).

---

## Section 12 — Observability: `sync_agent_traces`

New Supabase table:

```sql
create table sync_agent_traces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  run_id uuid not null,            -- groups one user message
  step_index int not null,
  step_kind text not null,         -- 'planner' | 'tool'
  tool_name text,
  input_json jsonb,
  output_json jsonb,
  shopify_cost_requested numeric,
  shopify_cost_actual numeric,
  shopify_throttle_available numeric,
  duration_ms int,
  error text,
  created_at timestamptz default now()
);

create index on sync_agent_traces (workspace_id, run_id, step_index);
```

Use cases: debug bad plans, build evals, charge credits accurately, detect regressions when prompts change.

---

## Section 13 — File-By-File Implementation Plan

### Phase 1 — Foundation (no logic break yet)
1. `src/lib/sync/core/types.ts` — add `ShopifyServerFilter`, `ClientPredicate`, `ProfileKey`, `SyncWorkingMemoryV2`, `AgentPlanV2`, `ToolClass`.
2. `src/lib/sync/providers/shopify/schema-catalog.ts` (new) — typed enum of valid filter keys + field cost weights for the planner's cost estimator.
3. `src/lib/sync/providers/shopify/graphql-client.ts` (new) — `ShopifyGraphQLClient` with cost-aware throttling, retry-on-THROTTLED, and `Shopify-GraphQL-Cost-Debug` toggle.
4. `src/lib/sync/providers/shopify/filter-builder.ts` (new) — `buildShopifyProductsQuery(filter): string` + `applyClientSidePredicates(rows, predicates): rows`.

### Phase 2 — Fetch + Collections
5. `src/lib/sync/providers/shopify/fetch-products.ts` — replace REST with GraphQL; signature accepts `filter`, `predicates`, `cursor`, `limit`. Single-page mode by default; bulk-op mode when caller passes `bulk: true`.
6. `src/lib/sync/providers/shopify/bulk-ops.ts` (new) — `submitBulkQuery`, `submitBulkMutation` (with `stagedUploadsCreate` + JSONL upload), `pollBulkOperation`, `downloadJsonl`.
7. `src/lib/sync/providers/shopify/collections.ts` (new) — `fetchCollections`, `resolveCollectionByName`, `createCollection`, `assignProductsToCollection`.
8. `src/lib/sync/providers/shopify/normalize.ts` — extend to include `collections` array column, `image_count`, `image_alt_text`, dynamic metafield columns when fetched.

### Phase 3 — Apply
9. `src/lib/sync/providers/shopify/payload-builders.ts` — add `buildProductSetInput(row, changedColumns): ProductSetInput`. Maps our generic columns to ProductSetInput.
10. `src/lib/sync/providers/shopify/apply.ts` — replace REST loop. New flow:
    - Group changes by scope: ≤25 → loop `productSet` with `ShopifyGraphQLClient`; >25 → bulk mutation.
    - Use `identifier: { handle }` for upserts.
    - Acquire Postgres advisory lock on `workspace_id`.
    - Parse `userErrors`, surface row-level failures.

### Phase 4 — Agent Planner + Executor
11. `src/app/api/sync/agent/route.ts` — major rewrite:
    - Remove old `createPlan`; replace with `runSupervisorPlanner` returning `AgentPlanV2`.
    - Plan schema fields: `strategy, scopeCap, columnProfile, serverFilter?, clientPredicates?, steps[], requiresConfirmation, costEstimate, scopeRationale`.
    - Hard server-side validation: clamp `scopeCap` to class defaults; reject filters with unknown keys.
    - Add `Reflector` between steps: on `userErrors` from a tool, decide retry/narrow/stop.
    - Stream NDJSON: planner → step.start → step.progress → step.end → reflection → done.
    - Emit `tracer.write` for every step.
12. `src/lib/sync/agent/tool-registry.ts` (new) — Zod schemas + handlers for every tool in §11.
13. `src/lib/sync/agent/reflector.ts` (new) — small LLM call (or rule-based) on tool output to choose next action.
14. `src/lib/sync/agent/policy.ts` (new) — three-tier confirmation policy + scopeCap class table.

### Phase 5 — Store + UI
15. `src/store/sync-store.ts` — replace `SyncWorkingMemory` with v2; add `currentColumnProfile`, `remainingCount`, `lastServerFilter` selectors.
16. `src/app/(dashboard)/w/[workspaceSlug]/sync/page.tsx`:
    - Delete `SHEET_VIEWS`, `SAFE_AUTO_EXECUTE_TOOLS`.
    - Render columns from `currentColumnProfile` via `COLUMN_PROFILES` lookup.
    - "Continue (N more)" button visible when `remainingCount > 0`.
    - Confirmation dialog driven by tool class + `requiresConfirmation`.
    - Add Collections tab (active when `columnProfile === "collections"` or after `load_collections`).
17. `src/components/sync/ColumnProfileChip.tsx` (new) — small badge showing current profile, click to switch via agent message.

### Phase 6 — Persistence + Observability
18. Supabase migration: create `sync_agent_traces` table.
19. `src/lib/sync/agent/tracer.ts` (new) — write-batched tracer (flush every 500ms or 10 rows).

### Phase 7 — Testing
20. Unit tests for `filter-builder` (every filter key + edge cases).
21. Unit tests for `graphql-client` cost throttle (mock Shopify response with extensions).
22. Unit tests for `payload-builders` (every column → ProductSetInput field).
23. Integration test: run a full plan against Shopify dev store with 50+ products and verify `productSet` + bulk path.
24. Eval set: 30 sample user messages → expected plan shape (snapshot tests).

---

## Section 14 — Migration Strategy

- **No feature flag.** Hard cutover on a single PR (large but contained).
- **Rollback plan**: keep old route file as `route.legacy.ts` for 2 weeks.
- **Data**: no data migration needed — sheets are session state, not persisted.
- **Scopes check**: on existing connected stores, pre-flight check that the saved access token has `read_products, write_products, read_inventory, write_inventory, read_publications, write_publications, read_files, write_files`. If missing, surface a banner "Re-authenticate to enable 2026 features".

---

## Section 15 — Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Shopify deprecates `productSet` semantics | Low | Pin to `2026-04`; monitor changelog. |
| Bulk op JSONL grows beyond 100 MB | Low | Pre-flight size check; split into multiple bulk runs (5 concurrent allowed). |
| Cost throttle starves long jobs | Medium | Promote to bulk op when estimated total cost > 5,000. |
| Agent picks wrong scopeCap | Medium | Server-side clamp; observability + eval set catches regressions. |
| Prompt injection from product titles | Medium | Sanitize all sheet content before embedding into prompts; never let user-controlled strings change tool schema. |
| Postgres advisory lock leak | Low | Use `pg_try_advisory_xact_lock` (transaction-scoped) — auto-released. |
| Webhook for bulk_operations/finish not delivered | Medium | Always also poll every 10s as fallback (max 24h). |
| Known bug: customId+metafields | Confirmed | Use handle-based upsert (already chosen). |

---

## Section 16 — Acceptance Criteria

- [ ] All filter strings produced by the agent are valid Shopify search-syntax (CI test against `schema-catalog`).
- [ ] No reference to `image_status`, `collection:'name'`, or any deprecated REST endpoint in product fetch path.
- [ ] `apply_to_shopify` uses `productSet` for ≤25 items and `bulkOperationRunMutation` for >25.
- [ ] Agent emits `columnProfile` in every plan; UI honors it; no `SHEET_VIEWS` remain.
- [ ] `scopeCap` is clamped server-side to class defaults; integration test verifies LLM cannot exceed.
- [ ] Confirmation tier policy enforced server-side (allowlist/denylist checked in route, not only client).
- [ ] `sync_agent_traces` rows written for every user message.
- [ ] Postgres advisory lock prevents concurrent apply from same workspace (test with two parallel requests).
- [ ] Cost-aware throttler sleeps appropriately (test with mocked low-bucket response).
- [ ] Continue/pagination works: "process the next 3" resumes from `lastCursor`.
- [ ] Collections fully supported: load, create manual, create smart with rules, assign products.
- [ ] User-error messages from `productSet.userErrors` surfaced per-row in apply receipt.

---

## Section 17 — Out Of Scope (v2)

- Webhook-based real-time sync from Shopify → app (one-way only for now).
- Multi-store / multi-locale storefront API.
- Markets and B2B pricing.
- Custom theme deployment.
- Subscriptions / selling plans editing.

These are explicit v3 candidates.
