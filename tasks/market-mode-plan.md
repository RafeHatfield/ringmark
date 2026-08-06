# Ringmark — Market Mode (Phase A of the Showcase initiative)

Rafe wants to expand Ringmark from a provenance tracker into a maker's discovery
layer — "the history for the piece, the rest is convenience." That larger effort
has two phases:

- **Phase A — Market Mode (this plan).** Fully private. Select published-or-not
  pieces for a specific in-person selling event (craft market, show), produce a
  packing checklist, a price sheet, and a QR label sheet, and mark pieces sold in
  the moment without going back into each object individually. Adds an optional
  price to every object as a side effect.
- **Phase B — Showcase.** Public. Per-piece and maker-level external links
  (Etsy, Instagram, personal site), a curated/all-published toggle, a photo
  gallery replacing today's text list, price display. Separate plan, not written
  yet, and **not touched by this one.**

Phase A ships first: it's entirely private (no public-surface security review,
no OG cards, no anon RLS), and it validates the `price_cents` field and the
"select a subset, produce artifacts" pattern before Phase B reuses both in a
public context. The two features look similar — "curate a subset of objects and
display it" — but their data shape differs enough that they must stay separate
schemas: Showcase's selection is one boolean per object; Market Mode's is
many-to-many (the same piece can go to three markets before it sells), with
per-event price and per-event sold state. Don't try to unify them.

## MCP inclusion — resolved, don't relitigate without a new reason

Market Mode ships MCP tools for **prep and after-the-fact operations** (create
an event, bulk-add pieces, reprice, review totals) — genuinely useful for
natural-language batch work at a desk. It does **not** make the live "mark sold"
action MCP-first. Standing at a table with a customer in front of you is a
one-tap-checkbox moment, not a chat turn — CLAUDE.md's "one hand, dusty bench"
rule applies directly. `mark_item_sold`/`unmark_item_sold` MCP tools still exist
(useful for an after-the-fact debrief — "I sold three things at the market,
here's what"), but the primary interface for the live moment is the mobile admin
UI in Phase 3.3, and it must stay fast: no confirmation modals, big tap targets.

No hosted/local asymmetry is needed for any Market Mode MCP tool (unlike
`delete_object`'s `force` gating). Every table here is 100% private — no public
page, no photo storage, no irreplaceable provenance data — so there is nothing
for a remote MCP call to put at risk that the account's own API key doesn't
already gate.

---

## Ground rules for implementers

1. **Read every file a task lists before editing it.** Match existing patterns
   exactly — this app has established conventions for RLS policies, Zod schemas,
   API route shape, and server-action structure. Don't invent new ones.
2. **Security invariants (never violate):**
   - `price_cents` is never selected in any public/anon-reachable query —
     `/p/[slug]`, `/maker`, `/{handle}/maker`, their `opengraph-image` routes,
     and `sitemap.ts`. It is admin-only data in this phase.
   - Every new table gets RLS. Market tables need **only** the
     `account_members`-scoped "members full access" policy — no anon policy at
     all (see `market_events`/`market_event_items` DDL in Task 0.1; contrast
     with `object_photos`, which needs one because it's publicly readable).
   - The admin UI (Phase 3) calls **server actions** (`actions/market-events.ts`),
     never the REST API. `app/api/v1/*` is Bearer-token-only, for MCP and
     external clients — the browser never holds an API key. This mirrors
     `actions/photos.ts` existing alongside `app/api/v1/objects/[id]/photos/route.ts`:
     same rules, two entry points, duplicated on purpose for the auth-boundary
     clarity it buys.
   - `account_id` always comes from `getOrCreateAccount()` (actions) or
     `authenticateApiRequest()` (API routes) — never from client input.
3. **File-collision rule — this is what makes parallel execution safe.**
   `lib/api-schemas.ts`, `lib/api-spec.ts`, and `mcp/server.ts` are single
   shared files. They are edited **once each**, in Task 0.2 and Task 2.1
   respectively, in one pass covering the entire new surface. No other task in
   this plan may touch them. Every other task works in its own new file or an
   existing file nothing else here touches — check the Files line before
   starting a task; if two in-flight tasks list the same file, run them
   sequentially, not concurrently.
4. **After every task:** `npx tsc --noEmit` and `npm run build` must pass.
   `npm test` after any `lib/` or `actions/` change. `npm run test:mcp` after
   any `mcp/` change. Named Playwright specs after page/action changes.
5. **One task = one commit**, semantic message (`feat:`, `test:`, `docs:`).
6. **Suggested agent assignment**, not a hard rule: Opus for 0.1/0.2 (schema and
   contract design — mistakes here are expensive to unwind later) and 3.3 (the
   market builder page — the most stateful UI in the plan). Sonnet for
   everything else — it's mechanical once the contract exists.
7. If a task's premise doesn't match the code you find, stop and note it in
   this file under the task rather than improvising.

## Parallelization map

```
Phase 0 (sequential, blocking)
  0.1 → 0.2
              │
              ▼
Phase 1 (parallel — different files)
  1.1  1.2  1.3  1.4
              │
      ┌───────┴───────┐
      ▼               ▼
Phase 2 (parallel)   Phase 3 (parallel — different files)
  2.1  2.2            3.1  3.2  3.3  3.4
      │               │
      └───────┬───────┘
              ▼
Phase 4 (parallel once 1–3 land)
  4.1  4.2
              │
              ▼
Phase 5
  5.1
```

---

## Phase 0 — Foundation (sequential, one agent, must land first)

### Task 0.1 — Schema: `price_cents` + `market_events` + `market_event_items`

- Files: new `supabase/migrations/<next-sequence>_market_mode.sql` (check
  `ls supabase/migrations` for the next timestamp/number in the existing
  `YYYYMMDDNNNNNN_description.sql` convention), `lib/types.ts`.
- Steps:
  1. Add the migration:

     ```sql
     -- ============================================================
     -- Market Mode: private, in-person selling events (craft markets, shows)
     --
     -- Fully private — no anon/public access at any point. Unlike wood_objects
     -- and object_photos, these tables need no anon RLS policy at all.
     -- ============================================================

     alter table wood_objects
       add column price_cents integer check (price_cents is null or price_cents >= 0);

     comment on column wood_objects.price_cents is
       'Optional asking price in cents (single currency — no multi-currency support). '
       'Informational only; Ringmark has no checkout. Default source when adding a '
       'piece to a market event.';

     -- ── market_events ──────────────────────────────────────────────────────

     create table market_events (
       id            uuid primary key default gen_random_uuid(),
       account_id    uuid not null references accounts(id) on delete cascade,
       name          text not null,
       event_date    date,
       location_text text,
       notes         text,
       status        text not null default 'planning'
                       check (status in ('planning', 'active', 'completed', 'cancelled')),
       created_at    timestamptz not null default now(),
       updated_at    timestamptz not null default now()
     );

     create index market_events_account_id_idx on market_events (account_id, event_date);

     alter table market_events enable row level security;

     create policy "market_events: members full access"
       on market_events
       for all
       to authenticated
       using (account_id in (select account_id from account_members where user_id = auth.uid()))
       with check (account_id in (select account_id from account_members where user_id = auth.uid()));

     -- ── market_event_items ─────────────────────────────────────────────────
     --
     -- A piece can appear at more than one event over its life (taken to a show,
     -- didn't sell, taken to the next). This is one such appearance: its own
     -- asking price, its own sold state, independent of any other event.

     create table market_event_items (
       id                 uuid primary key default gen_random_uuid(),
       account_id         uuid not null references accounts(id) on delete cascade,
       market_event_id    uuid not null references market_events(id) on delete cascade,
       object_id          uuid not null references wood_objects(id) on delete cascade,
       asking_price_cents integer check (asking_price_cents is null or asking_price_cents >= 0),
       sold               boolean not null default false,
       sold_price_cents   integer check (sold_price_cents is null or sold_price_cents >= 0),
       sold_at            timestamptz,
       sort_order         int not null default 0,
       created_at         timestamptz not null default now(),
       updated_at         timestamptz not null default now(),
       unique (market_event_id, object_id)
     );

     create index market_event_items_event_idx on market_event_items (market_event_id, sort_order);
     create index market_event_items_object_idx on market_event_items (object_id);

     alter table market_event_items enable row level security;

     create policy "market_event_items: members full access"
       on market_event_items
       for all
       to authenticated
       using (account_id in (select account_id from account_members where user_id = auth.uid()))
       with check (account_id in (select account_id from account_members where user_id = auth.uid()));
     ```

  2. In `lib/types.ts`, add `price_cents: number | null` to `WoodObject`/
     `WoodObjectInsert`/`WoodObjectUpdate` (follow the exact pattern used for
     `deleted_at`/`deleted_by` on `ObjectPhoto` — nullable on the row type,
     optional on Insert/Update), and add `MarketEvent`, `MarketEventInsert`,
     `MarketEventUpdate`, `MarketEventItem`, `MarketEventItemInsert`,
     `MarketEventItemUpdate` types mirroring the `ObjectPhoto*` family. Register
     both new tables in the `Database['public']['Tables']` map with their FK
     `Relationships` entries (see the `object_photos` entry for the shape).
- Accept: migration applies cleanly; `price_cents` exists on `wood_objects`;
  both new tables exist with RLS enabled and exactly one policy each; types
  compile.
- Verify: `npx tsc --noEmit`. Do **not** run `supabase db push` — that's a
  production schema change and needs explicit sign-off, same as every prior
  migration in this project.

### Task 0.2 — Zod schemas + OpenAPI registration (single pass, entire surface)

This is the parallelization seam for the whole plan — read the ground rules
file-collision note above before starting.

- Files: `lib/api-schemas.ts`, `lib/api-spec.ts`.
- Steps:
  1. In `lib/api-schemas.ts`:
     - Add `price_cents: z.number().int().nonnegative().nullable().optional()`
       to `WoodObjectSchema`, `CreateObjectSchema`, and `PatchObjectSchema`
       (the whitelist — this is what makes it settable via `POST`/`PATCH
       /api/v1/objects`).
     - `MarketEventSchema` — `id`, `account_id`, `name`, `event_date`
       (nullable), `location_text` (nullable), `notes` (nullable), `status`
       (enum `planning|active|completed|cancelled`), `created_at`,
       `updated_at`. `.openapi('MarketEvent')`.
     - `CreateMarketEventSchema` — `name` (required, min 1), `event_date`,
       `location_text`, `notes` all optional. No `status` — always starts
       `planning`.
     - `PatchMarketEventSchema` — all of the above optional, plus `status`
       (transition to `active`/`completed`/`cancelled`).
     - `MarketEventItemSchema` — the join row fields (`id`, `market_event_id`,
       `object_id`, `asking_price_cents`, `sold`, `sold_price_cents`,
       `sold_at`, `sort_order`, `created_at`, `updated_at`) **plus** denormalized
       display fields so callers never need a follow-up fetch: `workshop_id`,
       `title`, `public_title` (nullable), `species` (nullable),
       `thumbnail_url` (nullable — signed URL of the object's first photo,
       same pattern as `LineageStepSchema.thumbnail_url`). `.openapi('MarketEventItem')`.
     - `AddMarketItemSchema` — `object_id` (string — UUID or workshop ID,
       resolved via `resolveObject`), `asking_price_cents` (optional; server
       defaults from `wood_objects.price_cents` when omitted).
     - `BulkAddMarketItemsSchema` — `object_ids: z.array(z.string()).min(1).max(100)`.
     - `UpdateMarketItemSchema` — `asking_price_cents` (optional), `sort_order`
       (optional).
     - `MarkSoldSchema` — `sold_price_cents` (optional; server defaults to the
       item's current `asking_price_cents` when omitted — "sold at asking" is
       the common case, override for a haggled price).
     - `MarketEventTotalsSchema` — `item_count`, `sold_count`,
       `total_asking_cents`, `total_sold_cents` (all computed server-side, not
       stored). Embed as `totals: MarketEventTotalsSchema` in the "get one
       event with items" response shape.
  2. In `lib/api-spec.ts`, register every schema via `registry.register(...)`
     and add `registry.registerPath({...})` for all of:
     ```
     GET    /api/v1/market-events
     POST   /api/v1/market-events
     GET    /api/v1/market-events/{id}
     PATCH  /api/v1/market-events/{id}
     DELETE /api/v1/market-events/{id}
     POST   /api/v1/market-events/{id}/items
     POST   /api/v1/market-events/{id}/items/bulk
     PATCH  /api/v1/market-events/{id}/items/{itemId}
     DELETE /api/v1/market-events/{id}/items/{itemId}
     POST   /api/v1/market-events/{id}/items/{itemId}/mark-sold
     POST   /api/v1/market-events/{id}/items/{itemId}/unmark-sold
     ```
     Tag them all `'Market Events'`. Match the description density and
     `errorResponses` spreading of the existing `Photos` tag's paths.
- Accept: `generateSpec()` produces valid OpenAPI for all eleven paths;
  `npx tsc --noEmit` passes.
- Verify: `npx tsc --noEmit`; `curl localhost:3000/api/v1/openapi.json | jq
  '.paths | keys'` (with dev server running) shows all eleven.

---

## Phase 1 — Data layer: REST routes + server actions (parallel, 4 agents)

### Task 1.1 — `price_cents` on the existing object surface

- Files: `app/api/v1/objects/route.ts` (POST), `app/api/v1/objects/[id]/route.ts`
  (PATCH), `actions/objects.ts` (`createObject`, `updateObject`).
- Steps: thread `price_cents` through exactly like every other optional field
  already handled in these four functions (`species`, `location_text`, etc.) —
  no new pattern needed, the schemas from 0.2 already validate it.
- Accept: `price_cents` round-trips through create and update on both the API
  and the admin edit form's underlying action.
- Verify: `npx tsc --noEmit`; `npm run test:api`.

### Task 1.2 — `market-events` REST routes

- Files: new `app/api/v1/market-events/route.ts` (GET list, POST create), new
  `app/api/v1/market-events/[id]/route.ts` (GET one — include computed
  `totals` and the enriched item list, PATCH, DELETE).
- Steps: `authenticateApiRequest` + account scoping exactly like every other
  `app/api/v1/*` route (read `app/api/v1/objects/[id]/route.ts` first). DELETE
  needs no manual item cleanup — `market_event_items.market_event_id` cascades
  at the DB level (no photos, no storage, unlike object deletion). GET list
  supports `?status=` filtering.
- Accept: full CRUD works, account-scoped, 404 on cross-account access attempts.
- Verify: `npx tsc --noEmit`; new cases in `npm run test:api` (or defer to
  Phase 4.1's dedicated spec — either is fine, don't duplicate).

### Task 1.3 — `market-event items` REST routes (add, bulk-add, update, remove, sold state)

- Files: new `app/api/v1/market-events/[id]/items/route.ts` (POST add one),
  new `app/api/v1/market-events/[id]/items/bulk/route.ts` (POST bulk add), new
  `app/api/v1/market-events/[id]/items/[itemId]/route.ts` (PATCH, DELETE), new
  `app/api/v1/market-events/[id]/items/[itemId]/mark-sold/route.ts` (POST),
  new `app/api/v1/market-events/[id]/items/[itemId]/unmark-sold/route.ts` (POST).
- Steps:
  1. Object resolution uses `resolveObject` (`lib/resolve-object.ts`) so
     callers — especially MCP — can pass a workshop ID or a UUID.
  2. Bulk add: for each `object_id`, skip (don't fail the batch) if it doesn't
     resolve to this account or is already on this event (the `unique
     (market_event_id, object_id)` constraint). Return
     `{ added: MarketEventItem[], skipped: { id: string; reason: string }[] }`,
     status 200 — not 201, since it's not a single created resource.
  3. Single add: 409 with a clear message if the object is already on this
     event (map the unique-constraint violation).
  4. `mark-sold`: sets `sold = true`, `sold_price_cents` (from the body, or
     defaulting to the item's `asking_price_cents`), `sold_at = now()` — **and**,
     in the same request, updates `wood_objects.status = 'sold'` for that
     `object_id` (scoped to `account_id`). This is the one place this feature
     reaches outside its own tables; do it explicitly in the route handler as
     two scoped updates, not a DB trigger — matches this codebase's convention
     of keeping cross-table orchestration in application code (see how
     `root_id` cascade on re-parent is handled in `actions/objects.ts`, not a
     trigger).
  5. `unmark-sold`: clears `sold`/`sold_price_cents`/`sold_at`, and reverts
     `wood_objects.status` to `'for_sale'` (not whatever it was before —
     simplest reversible behavior; an object added to a market event was
     almost certainly `for_sale` beforehand, and this avoids a redundant
     "previous status" column).
- Accept: add/bulk-add/update/remove/mark-sold/unmark-sold all work,
  account-scoped; marking sold flips the underlying object's status; unmarking
  reverts it to `for_sale`.
- Verify: `npx tsc --noEmit`; covered fully by Phase 4.1.

### Task 1.4 — Server actions for the admin UI

- Files: new `actions/market-events.ts`.
- Steps: implement the same operations as 1.2/1.3, but as server actions using
  `getOrCreateAccount()` + a cookie-session `createClient()` — follow
  `actions/photos.ts` exactly for structure and error-return shape
  (`{ error?: string }` / `{ error?: string; id?: string }`). Functions:
  `createMarketEvent`, `updateMarketEvent`, `deleteMarketEvent`,
  `addMarketItem`, `addMarketItemsBulk`, `updateMarketItemPrice`,
  `removeMarketItem`, `markItemSold`, `unmarkItemSold`. `revalidatePath` the
  relevant `/markets` pages after each mutation (see `actions/photos.ts` for
  the pattern).
- Accept: every action verifies ownership before mutating (same contract
  `__tests__/security/action-ownership.test.ts` already enforces for
  `photos.ts`/`objects.ts`).
- Verify: `npx tsc --noEmit`.

---

## Phase 2 — MCP + docs (parallel with Phase 3, 2 agents)

### Task 2.1 — MCP tools (single pass — `mcp/server.ts` is shared, see ground rules)

- Files: `mcp/server.ts`, `__tests__/mcp/server.test.ts`,
  `e2e/mcp-endpoint.spec.ts`.
- Steps:
  1. Add `price_cents` as an optional param on the existing `create_object` and
     `update_object` tools (it's an ordinary internal field, not
     public/story — belongs with `species`/`status`, not with `save_story`).
  2. Add new tools, all using the existing `api()` helper (so
     `__tests__/mcp/contract-drift.test.ts` picks them up automatically — no
     changes needed to that test's parser):
     - `create_market_event` (name, event_date?, location_text?, notes?)
     - `list_market_events` (status?) — `readOnlyHint`
     - `get_market_event` (id) — returns items + totals — `readOnlyHint`
     - `update_market_event` (id, fields) — `idempotentHint`
     - `delete_market_event` (id) — `destructiveHint`. No force-gating
       asymmetry (see the MCP-inclusion note above) — same shape on both the
       remote and local server.
     - `add_market_items` (market_event_id, object_ids: string[]) — bulk,
       matches "go through and select all the items you want to take"
     - `remove_market_item` (market_event_id, object_id) — `destructiveHint`
     - `update_market_item_price` (market_event_id, object_id,
       asking_price_cents) — `idempotentHint`
     - `mark_item_sold` (market_event_id, object_id, sold_price_cents?) —
       `idempotentHint`. Describe clearly that this is for prep/debrief use;
       the live sale is recorded in the mobile UI (Task 3.3), not here.
     - `unmark_item_sold` (market_event_id, object_id) — `idempotentHint`
     All new tools: `openWorldHint: false` (same closed-world reasoning as
     every tool except `upload_photo`).
  3. Update `EXPECTED_TOOLS` in `__tests__/mcp/server.test.ts` (currently 15 —
     will become 25) and add coverage following the existing per-tool test
     style (see the `list_photos + delete_photo` describe block for the
     pattern: happy path, not-found, and — for the two sold-state tools —
     verify the underlying object status changes, mocking the API response).
  4. Update the tool-count assertions in `e2e/mcp-endpoint.spec.ts`.
- Accept: `npm run test:mcp` green, including the contract-drift test with zero
  changes to its parser.
- Verify: `npm run test:mcp`; `npx tsc --noEmit`.

### Task 2.2 — `docs/api.md` for the new surface

- Files: `docs/api.md`.
- Steps: document all eleven endpoints from Task 0.2/1.2/1.3 in the same
  format as the existing `Photos` section (path, description, request body
  table, response shape, example `curl`). Note the `mark-sold`/`unmark-sold`
  status-cascade behavior explicitly — it's the one surprising part of the
  contract.
- Accept: every new endpoint documented; matches existing section format.
- Verify: read-through only, no build impact.

---

## Phase 3 — Admin UI (parallel with Phase 2, internally parallel — 4 agents, all new files)

Mobile-first throughout, per this project's "one hand, dusty bench" rule — this
is more true here than almost anywhere else in the app, since 3.2–3.4 are used
standing at a market table.

### Task 3.1 — Price field on the object edit form + detail page

- Files: `app/(admin)/objects/[id]/edit/edit-object-form.tsx`,
  `app/(admin)/objects/[id]/page.tsx`.
- Steps: add a price input (accept dollars, store `price_cents` — multiply/
  divide by 100 at the form boundary only; everything else in the system stays
  in cents). Use the `FormField` wrapper from round2 Task 3.3
  (`components/form-field.tsx`) if the surrounding fields already use it — read
  the file first. Show it on the detail page near status when present (e.g.
  `$120 · For Sale`).
- Accept: settable, persists, displays.
- Verify: `npx playwright test e2e/workshop.spec.ts`.

### Task 3.2 — `/markets` list + `/markets/new`

- Files: new `app/(admin)/markets/page.tsx`, new `app/(admin)/markets/new/page.tsx`
  (+ a client form component if needed).
- Steps: list page shows events grouped or filterable by `status`, most recent
  first, each linking to `/markets/[id]`. New page: name, date, location,
  notes — calls `createMarketEvent` from `actions/market-events.ts`, redirects
  to the new event's detail page.
- Accept: create → land on the new event; list shows it.
- Verify: `npx tsc --noEmit`; manual click-through (no dedicated spec yet —
  covered by Phase 4.1).

### Task 3.3 — `/markets/[id]` — the market day builder (the core UI task)

- Files: new `app/(admin)/markets/[id]/page.tsx` + client components as needed.
- Steps:
  1. **Item picker** — search/filter across the account's objects (any
     status, published or not — a market piece doesn't need a public Ringmark
     page). Multi-select, "Add N to market" calls `addMarketItemsBulk`.
  2. **Item list** — thumbnail (reuse the signed-URL pattern from
     `lib/signed-urls.ts`'s `signPathsBatch`, added in round2 Task 3.2),
     workshop ID, title, inline-editable asking price, a large sold/unsold
     toggle (this is the button used live at the table — big tap target, no
     confirmation dialog, optimistic UI), remove button.
  3. **Ordering** — optional, nice-to-have: up/down arrows reusing
     `getSwapPair` from `lib/photo-utils.ts` (it's already generic over
     `{ id, sort_order }` — should need zero modification). Skip if it adds
     friction; this is not drag-and-drop and shouldn't become a project.
  4. **Running totals** footer — item count, sold count, total asking value,
     total sold value (server already computes these; just render them).
  5. Links to the three print views (Task 3.4).
- Accept: full loop works end to end from this one page — add, price, mark
  sold, remove.
- Verify: `npx tsc --noEmit`; manual; full coverage in Phase 4.1.

### Task 3.4 — Print views: packing list, price sheet, QR label sheet

> Collate and build — don't polish. The QR card layout is getting revisited
> separately, so treat `QrCard` as a component you assemble many of, not a
> layout to perfect. Iterate later.

- Files: new `app/(admin)/markets/[id]/pack/page.tsx`, new
  `app/(admin)/markets/[id]/price-sheet/page.tsx`, new
  `app/(admin)/markets/[id]/labels/page.tsx`.
- Steps: three server components, each `@media print`-styled (follow whatever
  print convention `app/(admin)/objects/[id]/qr/qr-card.tsx` already
  establishes — read it first rather than inventing a new one).
  - **Pack:** checkbox per item, workshop ID + title + thumbnail, no prices.
  - **Price sheet:** workshop ID + title + asking price, plus the total.
  - **Labels:** render the existing `QrCard` component once per item in a
    print grid — reuse it as-is, don't restyle it.
- Accept: all three render every item on the event and print sanely (rough is
  fine).
- Verify: manual — load each route, browser print preview.

---

## Phase 4 — Tests (parallel once Phases 1–3 land, 2 agents)

### Task 4.1 — `e2e/market-events.spec.ts`

- Files: new `e2e/market-events.spec.ts`.
- Steps: create event → add items (single + bulk) → verify totals → edit price
  → mark sold (assert the underlying object's `status` flips to `sold` via the
  API) → unmark sold (assert it reverts to `for_sale`) → remove item → delete
  event (assert items cascade). Add a cross-account isolation case matching
  `e2e/security-cross-account.spec.ts`'s pattern — account B cannot see or
  mutate account A's market event.
  Note: this suite benefits from the session-revocation fix already landed in
  `e2e/helpers/supabase-admin.ts` (`ensureTestUser`/`ensureSecondTestUser` no
  longer reset passwords unconditionally) — you shouldn't hit the
  full-suite-only auth-state flakiness that motivated that fix, but if you do,
  that file is where to look.
- Accept: full lifecycle green, including the cross-account case.
- Verify: `npx playwright test e2e/market-events.spec.ts`, then the full suite
  (`npx playwright test --project=chromium`) — expect 239 + this file's count,
  0 failed.

### Task 4.2 — Ownership contract tests for `actions/market-events.ts`

- Files: new `__tests__/security/market-ownership.test.ts` (or extend
  `action-ownership.test.ts` if it reads more naturally as one file — your
  call, match whichever keeps the file cohesive).
- Steps: same source-parsing approach as `action-ownership.test.ts` — assert
  every exported function calls `getOrCreateAccount()` and scopes its query to
  `account.id` before mutating.
- Accept: mirrors the existing contract for `photos.ts`/`objects.ts`.
- Verify: `npm test`.

---

## Phase 5 — Documentation sync

### Task 5.1 — CLAUDE.md + README

- Files: `CLAUDE.md`, `README.md` (if it lists routes/endpoints).
- Steps: add the `/markets/*` route group to CLAUDE.md's route structure
  table, the new `/api/v1/market-events/*` endpoints to its API endpoint list,
  and a short paragraph on the mark-sold status-cascade behavior next to the
  existing photo-soft-delete note (same density, same place). Do this last, so
  it reflects what actually got built rather than what was planned.
- Accept: matches actual final state.
- Verify: read-through only.

---

## Explicitly out of scope (don't do these)

- **Showcase (Phase B)** — links, curated/all-published toggle, gallery grid,
  public price display. Separate plan, not written yet.
- **Any public exposure of `price_cents`** in this phase, anywhere.
- **Multi-currency.** Single implicit currency, no currency column.
- **Cash/float tracking, till reconciliation, expenses.** Rafe was explicit
  this is not a bookkeeping tool.
- **Checkout, payments, anything transactional.** Ringmark has no commerce
  layer and this plan doesn't start one — `price_cents` is informational.
- **Drag-and-drop reordering.** Round 2 already declined this for photos; the
  optional up/down-arrow reuse in Task 3.3 is the ceiling here too.
- **A "previous status" column for the unmark-sold revert.** Reverting to
  `for_sale` unconditionally is the documented, intentional behavior.
- **New dependencies of any kind.**

## Completion checklist (run once, at the end)

```bash
npx tsc --noEmit && npm run lint && npm run build && npm test && npm run test:mcp && npm run test:api
```

All green, plus the full Playwright suite (`npx playwright test --project=chromium`)
— expect 0 failures at whatever the new total is.
