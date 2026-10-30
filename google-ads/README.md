# Google Ads agent

A Google Ads workspace inside Autommerce: the customer connects their Google Ads
account, then manages it like they would in Google Ads (campaigns, ad groups,
keywords, ads, assets, audiences, conversions) while an agent analyses, fixes
and builds on request. **Every change the agent makes waits for approval.**

Today this is a **front-end prototype on demo data** (`/w/[slug]/google-ads`).
Nothing reaches Google. This document is the plan for wiring it to the real API
without reshaping the UI.

## The whole thing in one page

1. **Connect.** The customer signs in with Google (OAuth, `adwords` scope). We
   store an encrypted refresh token for the workspace and list every account it
   can reach, including accounts under a manager (MCC).
2. **Choose an account.** The workspace works on one Google Ads customer at a
   time and can switch.
2b. **Merchant Center (optional, separate connection).** Its own Google consent
   (`content` scope) and its own account picker. The connect screen has two
   buttons, **Connect Google Ads** and **Connect Merchant Center**; **Go to agent**
   appears as soon as Google Ads is connected, so Merchant Center can wait.
   Inside the workspace, **Connections** (nav, and the account menu) shows both
   connections and lets the user change account, reconnect or disconnect either
   at any time, and checks that the chosen Merchant Center account is the one
   linked to the open ad account. Without it the agent keeps its Google Ads tools,
   reports product status from Google Ads and says what to connect; with it, the
   `merchant_*` tools (read statuses, propose feed fixes) unlock.
3. **Read.** Reports come from the Google Ads API (GAQL) into a short-lived
   cache in Supabase, so screens and the agent don't spend API quota twice.
4. **Ask the agent.** The agent reads through tools, never through raw
   credentials, and answers with analysis plus *proposed changes*.
5. **Approve.** Each proposal is a list of mutate operations. On approval the
   server runs them with `validateOnly` first, then for real.
6. **Undo.** Every applied change is logged with the operations that revert it.

## Files

| Path | Role |
| --- | --- |
| `src/lib/google-ads/types.ts` | Domain model mirroring Google Ads API resources, plus `MutateOp`, `ProposedChange`, `ChangeEvent` |
| `src/lib/google-ads/mutations.ts` | `applyOps` (pure; returns next state + inverse ops), diffs, keyword parsing, ad strength |
| `src/lib/google-ads/validation.ts` | Client copy of the checks Google applies (`validateOnly` stand-in) |
| `src/lib/google-ads/metrics.ts` | Metric derivation, date ranges, formatting |
| `src/lib/google-ads/store.ts` | Zustand store: connection, account snapshot, pending changes, history, chat |
| `src/lib/google-ads/agent-sim.ts` | Scripted agent: real analysis on the snapshot, real proposals. Replaced by the backend agent |
| `src/lib/google-ads/agent-runner.ts` | Plays an agent turn (steps → reply → proposals). Becomes the NDJSON stream reader |
| `src/lib/google-ads/agent-sim-advanced.ts` | Agent scenarios for Shopping, segments, monitoring, PMax assets, placements, demographics, experiments, forecasts |
| `src/lib/google-ads/analytics.ts` | Report segments, product and product-group metrics, placements, budget forecast, keyword ideas |
| `src/lib/google-ads/mock-data.ts`, `mock-extras.ts` | Demo accounts. Replaced by the server adapter |
| `src/components/google-ads/*` | Shell, connect flow, chat, top bar, nav, tables, chart, dialogs, campaign editor |
| `src/components/google-ads/views/*` | One file per screen (overview, campaigns, ad groups, ads, assets, keywords, negatives, search terms, audiences, locations, recommendations, conversions, library, settings, pending, history) |

The seam for the backend is narrow on purpose:

- **Reads:** `store.completeAuth` / `selectAccount` load an `AccountData`
  snapshot. Swap `buildDemoAccount()` for `GET /api/google-ads/accounts/:id/snapshot`.
- **Writes:** `store.applyChange` / `applyDirect` call `applyOps` locally. Swap for
  `POST /api/google-ads/mutate` with the same `MutateOp[]`, then refresh.
- **Agent:** `runAgentTurn` calls `planAgentTurn`. Swap for a streamed call to the
  agent service; it emits the same events (`step`, `text`, `change`).

## Screens

Overview · Recommendations · Reports (segments, CSV, scheduled reports) · Campaigns ·
Ad groups / Asset groups (with PMax asset ratings) · Product groups (Shopping
partition tree) · Ads · Assets · Products (Merchant Center status, catalog fixes) ·
Search keywords · Negative keywords · Search terms · Audiences (targeting,
exclusions, audience manager) · Demographics · Placements & content · Locations &
schedule · Keyword Planner · Performance Planner · Experiments · Conversions (value
rules, offline imports, enhanced conversions) · Shared library · Linked accounts ·
Account settings (content suitability, brand exclusions) · Campaign settings ·
Rules & alerts · Pending changes · Change history · All accounts (MCC view).

**Agent documents** (`src/lib/google-ads/docs.ts`, `agent-docs.ts`, `src/components/google-ads/docs/`):
plans, reports, audits, budget plans, keyword research, ad copy, feed reviews,
competitor analyses and experiment plans open as tabs beside the Account tab.
Documents are typed blocks (live KPIs and charts, tables, structure trees, ad
cards, timelines, health scores, executable checklists), versioned on every
edit, commented per section (the agent replies and can edit), exportable to
PDF, shareable by link, and schedulable (reports). Plan mode asks clarifying
questions first; long jobs show the specialist team and a task list. The
business profile and memory feed every document. Backend: `agent_documents`
(+ versions, comments) tables, and agent tools `doc_create`, `doc_update_section`,
`memory_write`; checklist steps reuse `ads_propose_change`.

Every table has a column picker and CSV download. Every change, from the UI or
the agent, goes through `MutateOp`s with validation, history and undo.

## Integration options

| | Own Google Ads API access | Markifact hosted MCP |
| --- | --- | --- |
| Google approvals | Cloud project, Basic/Standard access, OAuth verification | None for us: Markifact is an approved Standard Access developer |
| How customers connect | Our OAuth screen, per workspace | Customer accounts linked to **our** manager account (MCC), which our single Markifact connection can see; or white-label app credentials (Team plan) |
| Agent tools | Ours, described below | Markifact's: `find_operations`, `get_operation_inputs`, `run_operation`, `run_write_operation` (67 operations, 54 writes behind approval) |
| Approval | Our Pending changes → `POST mutate` | Our Pending changes → `run_write_operation`. **To confirm with Markifact:** how a headless client (Cursor SDK) confirms a write |
| Cost | API is free; we pay hosting | $79–249/month + credits (≈1 credit per data operation); cache reads to keep credits down |
| Risk | More work up front | Vendor dependency; confirm their terms allow serving our customers through one account |

Either way the UI stays the same: the seam is the read adapter and the mutate
executor. With Markifact, `ads_propose_change` stays ours (it only writes a
pending change); applying calls Markifact's write operation.

## Backend (next phase)

### API routes (`src/app/api/google-ads/`)

| Route | Does |
| --- | --- |
| `GET oauth/start` | Builds the Google consent URL (`access_type=offline`, `prompt=consent`, state bound to workspace + user) |
| `GET oauth/callback` | Exchanges the code, encrypts the refresh token, calls `ListAccessibleCustomers` |
| `GET accounts` | Accessible customers (with manager hierarchy via `customer_client`) |
| `POST accounts/select` | Sets the workspace's active customer and `login-customer-id` |
| `GET accounts/:id/snapshot` | Structure + metrics for a date range, served from cache when fresh |
| `POST mutate` | Runs a `ProposedChange`: role check → `validateOnly` → mutate → log → invalidate cache |
| `POST changes/:id/undo` | Applies the stored inverse ops |
| `DELETE connection` | Revokes the token at Google and deletes it |

Server-side Google client: one module (`src/lib/google-ads/server/client.ts`)
that takes a workspace id, decrypts the token with `src/lib/integrations/crypto.ts`,
refreshes the access token and calls REST
`googleads.googleapis.com/vNN/customers/{id}/googleAds:searchStream` and the
`:mutate` endpoints. Money crosses this boundary in micros: divide by 1e6 on read,
multiply on write.

### Agent tools (`assistant-service`)

The agent runs on the existing Cursor SDK service, with Google Ads tools added
next to the current ones. Tools receive the workspace and customer from the
server session, **never from the model**, so one workspace can't reach another's
account.

| Tool | Kind |
| --- | --- |
| `ads_report` | Read: GAQL against an allowlist of resources/fields, row limit, cached |
| `ads_get_structure` | Read: campaigns, ad groups, keywords, ads, assets |
| `ads_search_terms` | Read: search term view |
| `ads_recommendations` | Read: Google recommendations |
| `ads_conversions` | Read: conversion actions and status |
| `ads_keyword_planner` | Read: keyword ideas and volumes |
| `ads_policy_check` | Read: policy topics for ads and keywords |
| `catalog_lookup` | Read: products from the workspace catalog (titles, features, prices, images) |
| `ads_validate_mutation` | Runs `validateOnly` on proposed ops |
| `ads_propose_change` | Writes a `ProposedChange` (status `PENDING`). **The only write tool.** |

There is deliberately no "apply" tool. Applying is a user action through
`POST mutate`, or automatic only when the workspace turned on auto-approve.

## Database (draft, not applied)

See [`schema-draft.sql`](schema-draft.sql). Five tables, all scoped by
`workspace_id` with the same `is_workspace_member` RLS as `workspace_integrations`:

| Table | Holds |
| --- | --- |
| `google_ads_connections` | One per workspace: Google account email, encrypted refresh token, active customer id, login customer id, scopes, status |
| `google_ads_accounts` | Accessible customers cached from the last listing (name, currency, time zone, manager) |
| `google_ads_report_cache` | Snapshot JSON per customer + date range + kind, with `expires_at` |
| `google_ads_changes` | Proposed and applied changes: source, title, rationale, ops, diff, status, who approved, Google response |
| `google_ads_change_events` | Applied changes with inverse ops, for history and undo |

Agent conversations reuse the existing assistant conversation storage.

## Safety rules

- Agent proposals are `PENDING` until approved. Auto-approve is opt-in per workspace.
- Viewers can read; editors can approve; only admins connect, switch or disconnect.
- Every mutate runs `validateOnly` first. Budget increases above a set ratio are
  flagged high risk and never auto-applied.
- Billing is out of scope: the API can't touch payment methods and neither can we.
- API quota is shared across all workspaces (15,000 operations/day at Basic access):
  reads go through the cache and each workspace has a daily budget of operations.

## Google access (prerequisites)

| Step | Notes |
| --- | --- |
| Google Cloud project with the Google Ads API enabled | Gives Test access (test accounts only) |
| Explorer access | Production accounts, 2,880 operations/day. Enough for pilots |
| Brand verification, then Basic access | 15,000 operations/day. Needed for launch |
| OAuth app verification for the `adwords` scope | Sensitive scope; until verified, users see a warning and the app is capped at 100 users |
| Standard access | Unlimited operations; requires Required Minimum Functionality (RMF) for the features we offer |

Developer tokens were retired on 2026-09-09; access levels now belong to the
Google Cloud project.

## Rollout

1. **Analyst:** connect, reports, agent analysis and audits. Read-only.
2. **Operator:** approved changes to status, budgets, bids, keywords, negatives, ads, assets.
3. **Builder:** full campaign creation (Search, Performance Max, Shopping with Merchant
   Center), scheduled monitoring and alerts.
