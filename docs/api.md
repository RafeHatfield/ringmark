# Ringmark REST API v1

## Overview

The REST API provides programmatic access to Ringmark workshop data. It is designed for LLM/MCP clients and integrations that need to read or write object data without a browser session.

**Base URL:** `http://localhost:3000` (dev) / `https://ringmark.org` (production)

**Versioning:** All endpoints are prefixed with `/api/v1/`. Breaking changes will increment the version prefix.

**Content type:** All request and response bodies are `application/json`.

---

## Authentication

All object endpoints require a Bearer token in the `Authorization` header:

```bash
Authorization: Bearer $RINGMARK_API_KEY
```

Set `RINGMARK_API_KEY` in your environment (`.env.local` for dev, Vercel environment variables for production). The server performs a timing-safe comparison — missing or invalid keys return `401`.

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

Permanently delete an object. Children are cascade-deleted by the database.

**Path parameter:** `id` — UUID or workshop ID

**Response (204):** No content.

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/v1/objects/RH7 \
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
