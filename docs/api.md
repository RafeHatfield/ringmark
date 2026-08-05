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
