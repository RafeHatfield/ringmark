# Ringmark REST API v1

## Overview

The REST API provides programmatic access to Ringmark workshop data. It is designed for LLM/MCP clients and integrations that need to read or write object data without a browser session.

**Base URL:** `http://localhost:3000` (dev) / `https://ringmark.org` (production)

**Versioning:** All endpoints are prefixed with `/api/v1/`. Breaking changes will increment the version prefix.

**Content type:** All request and response bodies are `application/json`.

---

## Authentication

All object endpoints require a Bearer token in the `Authorization` header. Two
credential types are accepted, distinguished by shape — a JWT is routed to OAuth
verification, anything else is treated as an opaque API key.

**1. Account API key** — for scripts, CI, and the local stdio MCP server.

```bash
Authorization: Bearer $RINGMARK_API_KEY
```

Generate one at **Settings → API Keys**. Only a SHA-256 hash is stored, so the
raw key is shown once at creation and never again. Keys are scoped to the
account that owns them; revoking one takes effect immediately.

**2. OAuth 2.1 access token** — for claude.ai and other MCP clients.

Issued by Supabase Auth's OAuth server and verified here against the project
JWKS. The token must be audience-bound to this resource server (RFC 8707); a
token minted for a different resource is rejected even with a valid signature.
The account is resolved from the token subject via `account_members`.

> **Audience binding needs a Postgres hook.** Supabase Auth does not implement
> RFC 8707 — the `resource` parameter is accepted and ignored, and tokens are
> issued with `aud: "authenticated"`. The Custom Access Token Hook in
> `supabase/migrations/20260805000001_oauth_audience_hook.sql` rewrites `aud`
> for OAuth-issued tokens only. It must be registered under **Authentication →
> Hooks**; the migration alone does nothing. Until it is, every OAuth token is
> rejected — deliberately, since an unbound token is exactly what RFC 8707
> exists to prevent.
>
> Verify with `node --env-file=.env.local scripts/verify-oauth-flow.mjs`.

> There is deliberately no shared-secret fallback. An earlier version accepted a
> single `RINGMARK_API_KEY` from the environment and resolved it to "the oldest
> account in the database", which leaks one tenant's data to anyone holding the
> secret once more than one account exists. That key is now an ordinary row in
> `api_keys`.

Missing or invalid credentials return `401`.

The OpenAPI spec (`/api/v1/openapi.json`) and Swagger UI (`/api/v1/docs`) do not require authentication.

**Example:**

```bash
curl http://localhost:3000/api/v1/objects \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

## Endpoints

### GET /api/v1/objects

List workshop objects, newest-updated first.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search term — matches workshop ID, title, species, public title |
| `type` | string | Filter by object type (e.g. `blank`, `finished_bowl`) |
| `status` | string | Filter by status (e.g. `drying`, `for_sale`) |
| `published` | `true` \| `false` | Filter by publish state |
| `limit` | integer | Max results, 1–50 (default `20`) |
| `offset` | integer | Pagination offset (default `0`) |

**Response (200):**

```json
{
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "workshop_id": "RH1",
      "object_type": "source",
      "status": "stored",
      "title": "Lynn Valley Big Leaf Maple",
      "species": "Bigleaf Maple",
      "is_published": false,
      "updated_at": "2026-06-19T10:00:00.000Z"
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Example:**

```bash
curl "http://localhost:3000/api/v1/objects?q=maple&type=blank&limit=10" \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### POST /api/v1/objects

Create a new root-level workshop object. Workshop ID and public slug are auto-generated if not provided.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `object_type` | string | no | Defaults to `source` |
| `workshop_id` | string | no | Auto-generated from account prefix if omitted |
| `title` | string | no | Internal title |
| `species` | string | no | Wood species |
| `status` | string | no | Defaults to `acquired` |
| `location_text` | string | no | Private — never shown on public page |
| `private_notes` | string | no | Private notes |
| `price_cents` | integer \| null | no | Optional asking price in cents. Never exposed on public pages |

**Response (201):** Full `WoodObject` (see schema below).

**Error responses:** `400` validation error, `409` workshop ID already taken.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/objects \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"object_type": "source", "title": "Lynn Valley Maple", "species": "Bigleaf Maple"}'
```

---

### GET /api/v1/objects/:id

Fetch a single object by UUID or workshop ID. Workshop IDs are case-insensitive (e.g. `RH1` and `rh1` both work).

**Path parameter:** `id` — UUID or workshop ID (e.g. `RH1`, `RH1-2`)

**Response (200):** Full `WoodObject`.

**Example:**

```bash
curl http://localhost:3000/api/v1/objects/RH1 \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### PATCH /api/v1/objects/:id

Partial update — only include the fields you want to change. `public_slug`, `account_id`, `workshop_id`, and `workshop_id_lower` are not accepted (Zod whitelist enforces this).

Set `is_published: true` to publish; `false` to unpublish.

**Path parameter:** `id` — UUID or workshop ID

**Request body (all fields optional):**

| Field | Type | Description |
|-------|------|-------------|
| `object_type` | string | Change object type |
| `status` | string | Change status |
| `title` | string | Internal title |
| `species` | string | Wood species |
| `location_text` | string | Private location |
| `private_notes` | string | Private notes |
| `public_title` | string | Title shown on public page |
| `public_story` | string | Story text on public page |
| `public_notes` | string | Additional public notes |
| `public_care` | string | Care instructions |
| `dimensions_text` | string | e.g. `12" × 4"` |
| `finish` | string | e.g. `Walnut oil` |
| `price_cents` | integer \| null | Optional asking price in cents. Pass `null` to clear. Never exposed on public pages |
| `is_published` | boolean | `true` to publish, `false` to unpublish |

**Response (200):** Updated full `WoodObject`.

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/v1/objects/RH1 \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "finished", "is_published": true}'
```

---

### DELETE /api/v1/objects/:id

Permanently delete an object and remove its photo files from storage — including
any photos that were previously soft-deleted, so nothing is left orphaned. This
is the only irreversible delete in the API.

**Path parameter:** `id` — UUID or workshop ID

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `force` | `true` | Required to delete a **published** object, taking its live public page down |

**Guards:**

- **Published objects** return `409` unless `?force=true`.
- **Objects with children** return `409` always — `force` does not override this.
  Delete or re-parent the children first.

**Response (204):** No content.

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/objects/RH7 \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### GET /api/v1/objects/:id/photos

List photos attached to an object, each with a signed URL valid for one hour.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `include_deleted` | `true` | Include soft-deleted photos; their `deleted_at` will be non-null |

Soft-deleted photos are excluded by default, so the response matches what is
actually live on the object.

---

### POST /api/v1/objects/:id/photos

Upload a photo via `multipart/form-data` (JPEG, PNG, WebP, or HEIC). Fields:
`file` (required) and `caption` (optional).

**Response (201):** Photo record with a one-hour signed URL.

---

### PATCH /api/v1/objects/:id/photos/:photoId

Update a photo's caption. Does not touch the image file or sort order. Pass an
empty string to clear.

---

### DELETE /api/v1/objects/:id/photos/:photoId

**Soft delete.** The photo drops out of every read path immediately — including
the public story page and the OG share card — but the image file is retained so
the delete can be reversed.

The `object-photos` bucket is private and every public read mints a signed URL
on demand, so removing the photo from the read paths is what makes it
unreachable; no file deletion is required for that.

**Response (204):** No content. Deleting an already-deleted photo returns `404`.

---

### POST /api/v1/objects/:id/photos/:photoId/restore

Reverse a soft delete, returning the photo to its original sort position.
`sort_order` is never reclaimed while a photo is deleted, so a restore cannot
collide with a photo uploaded in the meantime.

**Response (200):** Restored photo record with a fresh signed URL.
Returns `404` if the photo does not exist or is not currently deleted.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/objects/RH1/photos/$PHOTO_ID/restore \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### POST /api/v1/objects/:id/children

Add a child object derived from the given parent (e.g. a bowl blank from a log). Workshop ID is auto-generated using flat descendant numbering (`RH1` → `RH1-1`, `RH1-2`, …). Species is inherited from the parent if not provided.

**Path parameter:** `id` — parent UUID or workshop ID

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `object_type` | string | yes | Children must have an explicit type |
| `title` | string | no | Internal title |
| `species` | string | no | Inherited from parent if omitted |
| `status` | string | no | |
| `private_notes` | string | no | |

**Response (201):** Full `WoodObject` for the new child.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/objects/RH1/children \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"object_type": "blank", "status": "drying"}'
```

---

Market events are private, in-person selling events (craft markets, shows) —
which pieces you took, what you priced them at, and which sold. Nothing under
this section, and no `price_cents` value anywhere, is ever selected in a
public or anon-reachable query; none of it appears on `/p/[slug]`, the maker
page, their `opengraph-image` routes, or `sitemap.ts`. A piece can be added to
a market event regardless of its `status` or publish state — a market piece
does not need a public Ringmark page. `id` in these paths is always the market
event's own UUID (market events have no workshop-ID-style human identifier);
`object_id` in request bodies accepts a workshop ID or a UUID, resolved the
same way as everywhere else in the API.

---

### GET /api/v1/market-events

List the account's market events, most recent first.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (`planning`, `active`, `completed`, `cancelled`) |

**Response (200):**

```json
{
  "data": [
    {
      "id": "b1f6b0a2-9e3e-4b7d-8f2a-1c9d6e4a7f21",
      "account_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Lynn Valley Farmers Market",
      "event_date": "2026-08-16",
      "location_text": "Lynn Valley Village, North Vancouver",
      "notes": "Bring the folding table",
      "status": "planning",
      "created_at": "2026-08-04T10:00:00.000Z",
      "updated_at": "2026-08-04T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

**Example:**

```bash
curl "http://localhost:3000/api/v1/market-events?status=planning" \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### POST /api/v1/market-events

Create a market event. Always starts in `planning` status — `status` is not
accepted on create, only on `PATCH`. `event_date` is optional; a market can be
planned before its date is fixed.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | |
| `event_date` | string | no | ISO date, e.g. `2026-08-16` |
| `location_text` | string | no | |
| `notes` | string | no | |

**Response (201):** Full `MarketEvent`.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/market-events \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Lynn Valley Farmers Market", "event_date": "2026-08-16"}'
```

---

### GET /api/v1/market-events/:id

Fetch a market event with every item on it and server-computed totals — one
round trip, no follow-up fetch needed to render a market list.

**Path parameter:** `id` — market event UUID

**Response (200):** `MarketEventDetail` — the `MarketEvent` fields plus
`items` (each a `MarketEventItem`, denormalized with `workshop_id`, `title`,
`public_title`, `species`, and a 1-hour signed `thumbnail_url` so the caller
never needs a second fetch) and `totals` (computed server-side on every
request, never stored):

```json
{
  "id": "b1f6b0a2-9e3e-4b7d-8f2a-1c9d6e4a7f21",
  "account_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Lynn Valley Farmers Market",
  "event_date": "2026-08-16",
  "location_text": "Lynn Valley Village, North Vancouver",
  "notes": "Bring the folding table",
  "status": "planning",
  "created_at": "2026-08-04T10:00:00.000Z",
  "updated_at": "2026-08-04T10:00:00.000Z",
  "items": [
    {
      "id": "d4e6f0a1-2b3c-4d5e-8f9a-0b1c2d3e4f5a",
      "market_event_id": "b1f6b0a2-9e3e-4b7d-8f2a-1c9d6e4a7f21",
      "object_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "asking_price_cents": 12000,
      "sold": false,
      "sold_price_cents": null,
      "sold_at": null,
      "sort_order": 0,
      "created_at": "2026-08-04T10:05:00.000Z",
      "updated_at": "2026-08-04T10:05:00.000Z",
      "workshop_id": "RH9-4",
      "title": "Maple Bowl",
      "public_title": "Bigleaf Maple Bowl",
      "species": "Bigleaf Maple",
      "thumbnail_url": "https://.../object-photos/signed?..."
    }
  ],
  "totals": {
    "item_count": 1,
    "sold_count": 0,
    "total_asking_cents": 12000,
    "total_sold_cents": 0
  }
}
```

**Example:**

```bash
curl http://localhost:3000/api/v1/market-events/$EVENT_ID \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### PATCH /api/v1/market-events/:id

Partial update — only include the fields you want to change. Use `status` to
transition the event through `planning` → `active` → `completed` (or
`cancelled`).

**Path parameter:** `id` — market event UUID

**Request body (all fields optional):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | |
| `event_date` | string \| null | |
| `location_text` | string \| null | |
| `notes` | string \| null | |
| `status` | string | `planning`, `active`, `completed`, or `cancelled` |

**Response (200):** Updated full `MarketEvent`.

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/v1/market-events/$EVENT_ID \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "active"}'
```

---

### DELETE /api/v1/market-events/:id

Delete a market event and its items. Items cascade at the database level — no
manual cleanup, unlike object deletion (no photos, no storage involved here).
The pieces themselves are untouched; this only removes the record of them
having been taken to this market.

**Path parameter:** `id` — market event UUID

**Response (204):** No content.

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/market-events/$EVENT_ID \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### POST /api/v1/market-events/:id/items

Add a single piece to a market event.

Any object can be added regardless of its `status` or publish state — a
market piece does not need a public Ringmark page. `asking_price_cents`
defaults to the object's own `price_cents` when omitted.

**Path parameter:** `id` — market event UUID

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `object_id` | string | yes | Workshop ID or UUID |
| `asking_price_cents` | integer \| null | no | Defaults to the object's `price_cents` |

**Response (201):** Full `MarketEventItem`.

**Error responses:** `400` validation error, `404` event or object not found, `409` the piece is already on this event.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/market-events/$EVENT_ID/items \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"object_id": "RH9-4", "asking_price_cents": 12000}'
```

---

### POST /api/v1/market-events/:id/items/bulk

Add several pieces at once — the "go through and select everything you want
to take" path.

Pieces that don't resolve to an object in this account, or are already on
this event (the `unique (market_event_id, object_id)` constraint), are
**skipped, not failed** — the rest of the batch still adds. Response status is
`200`, not `201`: this isn't a single created resource.

**Path parameter:** `id` — market event UUID

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `object_ids` | string[] | yes | 1–100 workshop IDs or UUIDs |

**Response (200):**

```json
{
  "added": [
    {
      "id": "d4e6f0a1-2b3c-4d5e-8f9a-0b1c2d3e4f5a",
      "market_event_id": "b1f6b0a2-9e3e-4b7d-8f2a-1c9d6e4a7f21",
      "object_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "asking_price_cents": 12000,
      "sold": false,
      "sold_price_cents": null,
      "sold_at": null,
      "sort_order": 0,
      "created_at": "2026-08-04T10:05:00.000Z",
      "updated_at": "2026-08-04T10:05:00.000Z",
      "workshop_id": "RH9-4",
      "title": "Maple Bowl",
      "public_title": "Bigleaf Maple Bowl",
      "species": "Bigleaf Maple",
      "thumbnail_url": "https://.../object-photos/signed?..."
    }
  ],
  "skipped": [
    { "id": "RH2", "reason": "Already on this event" }
  ]
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/market-events/$EVENT_ID/items/bulk \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"object_ids": ["RH9-4", "RH12", "RH3-1"]}'
```

---

### PATCH /api/v1/market-events/:id/items/:itemId

Change the asking price or sort order for this piece **at this event only** —
it does not touch the object's own `price_cents`, or any other event the same
piece may also be on.

**Path parameters:** `id` — market event UUID, `itemId` — market event item UUID

**Request body (all fields optional):**

| Field | Type | Description |
|-------|------|-------------|
| `asking_price_cents` | integer \| null | |
| `sort_order` | integer | |

**Response (200):** Updated full `MarketEventItem`.

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/v1/market-events/$EVENT_ID/items/$ITEM_ID \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"asking_price_cents": 9500}'
```

---

### DELETE /api/v1/market-events/:id/items/:itemId

Remove a piece from a market event. Removes the item only — the piece itself,
and its `price_cents`, are untouched.

**Path parameters:** `id` — market event UUID, `itemId` — market event item UUID

**Response (204):** No content.

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/market-events/$EVENT_ID/items/$ITEM_ID \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

### POST /api/v1/market-events/:id/items/:itemId/mark-sold

Mark a piece sold at this market.

Sets `sold: true`, `sold_price_cents` (from the body, or defaulting to the
item's `asking_price_cents` — "sold at asking" is the common case, override
for a haggled price), and `sold_at`. **This is the one place Market Mode
reaches outside its own tables:** in the same request, it also sets the
underlying object's `status` to `sold`, scoped to the account. It's done as an
explicit application-code update, not a DB trigger — matching how this
codebase keeps cross-table orchestration in application code elsewhere (e.g.
the `root_id` cascade on re-parent in `actions/objects.ts`).

**Path parameters:** `id` — market event UUID, `itemId` — market event item UUID

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sold_price_cents` | integer | no | Defaults to the item's `asking_price_cents` |

**Response (200):** Updated full `MarketEventItem`.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/market-events/$EVENT_ID/items/$ITEM_ID/mark-sold \
  -H "Authorization: Bearer $RINGMARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### POST /api/v1/market-events/:id/items/:itemId/unmark-sold

Undo a sale. Clears `sold`, `sold_price_cents`, and `sold_at`, and reverts the
underlying object's `status` to `for_sale` — **unconditionally, not to
whatever status it held before.** A piece taken to a market was almost
certainly `for_sale` beforehand, and this is a deliberate design choice: it
avoids a redundant "previous status" column just to support the revert.

**Path parameters:** `id` — market event UUID, `itemId` — market event item UUID

**Response (200):** Updated full `MarketEventItem`.

**Example:**

```bash
curl -X POST http://localhost:3000/api/v1/market-events/$EVENT_ID/items/$ITEM_ID/unmark-sold \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

---

## Error Responses

All error responses use this shape:

```json
{ "error": "Human-readable description" }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error — check the error message for which field |
| 401 | Unauthorized — missing, invalid, or no `RINGMARK_API_KEY` set on server |
| 404 | Object not found (or not owned by this account) |
| 409 | Workshop ID conflict — the requested workshop ID is already taken |
| 500 | Internal server error |

---

## WoodObject Schema

Full object shape returned by GET (single), POST, and PATCH responses:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Internal identifier |
| `workshop_id` | string | Human-readable ID (e.g. `RH1`) |
| `workshop_id_lower` | string | Lowercase for collision checks |
| `object_type` | string | One of the object type enum values |
| `status` | string \| null | Current lifecycle status |
| `title` | string \| null | Internal title |
| `species` | string \| null | Wood species |
| `species_confidence` | string \| null | `confirmed`, `likely`, `guessed`, `unknown` |
| `dimensions_text` | string \| null | e.g. `12" × 4"` |
| `finish` | string \| null | e.g. `Walnut oil` |
| `public_slug` | string | Immutable public URL slug |
| `public_title` | string \| null | Title shown on `/p/[slug]` |
| `public_story` | string \| null | Story text on public page |
| `public_notes` | string \| null | Additional public notes |
| `public_care` | string \| null | Care instructions |
| `location_text` | string \| null | Private — not shown on public page |
| `private_notes` | string \| null | Private — not shown on public page |
| `is_published` | boolean | Whether the public story is live |
| `price_cents` | integer \| null | Optional asking price in cents. Informational only — never selected in any public/anon-reachable query |
| `parent_id` | UUID \| null | Direct parent |
| `root_id` | UUID \| null | Root ancestor |
| `lineage_confidence` | string \| null | `exact`, `probable`, `batch_level`, `unknown` |
| `account_id` | UUID | Owning account |
| `created_at` | ISO 8601 | |
| `updated_at` | ISO 8601 | |

---

## Interactive Docs

- **Swagger UI:** `GET /api/v1/docs` — interactive browser-based API explorer (no auth required)
- **OpenAPI 3.1 spec:** `GET /api/v1/openapi.json` — machine-readable spec for code generation or import into tools like Postman (no auth required)

The Swagger UI is generated from the same Zod schemas that validate requests (`lib/api-schemas.ts`), so the docs are always in sync with actual validation.

---

## Remote MCP endpoint

`POST /api/mcp` exposes the same data as a Model Context Protocol server over
Streamable HTTP, for claude.ai custom connectors and any standard MCP client.
Tool handlers proxy the REST endpoints documented above, so authorization lives
in exactly one place.

**Transport.** Clients must send `Accept: application/json, text/event-stream`.
Anything else returns `406` — this is a requirement of the Streamable HTTP
spec, not a Ringmark choice. Successful responses are SSE-framed.

**Discovery.** An unauthenticated request returns `401` with an RFC 9728
challenge naming the metadata document:

```
WWW-Authenticate: Bearer realm="ringmark", error="invalid_token",
                  resource_metadata="https://ringmark.org/.well-known/oauth-protected-resource"
```

```bash
curl -s https://ringmark.org/.well-known/oauth-protected-resource | jq
```

**Tool surface.** Identical to the local stdio server with one deliberate
difference: `delete_object` is registered without its `force` parameter. Combined
with the API's existing guards (published objects and objects with children are
both blocked), the only object this endpoint can delete is an unpublished leaf.
`delete_photo` is a soft delete, reversible with `restore_photo`.

`mcp/server.ts` is the single definition of the tool surface, shared by both
transports. `__tests__/mcp/contract-drift.test.ts` asserts every endpoint the
tools call still exists in the OpenAPI spec.

---

## Rate limiting

Rate limiting for `/api/mcp` and `/api/v1/*` is configured as **Vercel WAF
rules**, not in this repository — there is no code to read, so it is documented
here instead.

Configure under **Vercel → Project → Firewall → Rate Limiting**:

| Rule | Path | Limit | Action |
| --- | --- | --- | --- |
| MCP endpoint | `/api/mcp` | 60 req/min per IP | Deny (429) |
| REST API | `/api/v1/*` | 120 req/min per IP | Deny (429) |
| Metadata | `/.well-known/*` | 30 req/min per IP | Deny (429) |

Notes:

- These are **per-IP**, not per-token. An IP limit is the right tool against
  scraping and brute-force; it does not give a single tenant a fair-use quota.
  Per-token quotas need shared state (Upstash or similar) and are deliberately
  out of scope until there are enough users for it to matter.
- Keep `/.well-known/*` generous enough for discovery retries — throttling it
  breaks the OAuth flow before it starts, and the endpoint is cheap and public
  by design.
- Set limits well above the burst an MCP client produces during a normal
  session; a single inventory conversation can fire a dozen tool calls in a few
  seconds.
