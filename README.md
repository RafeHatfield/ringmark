# Ringmark

Mobile-first web app for woodturners to track wood from source to finished piece and share that story with buyers.

Each piece of wood gets a short workshop ID (written with a Sharpie) and a permanent QR code. Scanning the QR routes to two experiences: the logged-in owner gets the full admin view; everyone else sees the public story page.

**Stack:** Next.js 15 App Router · Supabase (Postgres + Auth + Storage) · shadcn/ui · Tailwind CSS · TypeScript strict

---

## Core concepts

- **One QR, two experiences** — `/p/[slug]` routes to admin (owner) or public page (everyone else). Auth decision is server-side.
- **One record, many states** — a blank becoming a finished bowl is the same record updated, not a new one. Splits create children.
- **Three identifiers** — UUID (internal), workshop ID (human/Sharpie, mutable), public slug (QR/URL, immutable).
- **Flat descendant IDs** — `RH1-3` is a grandchild of `RH1`, not `RH1-1-1`. The suffix is a counter under the root; lineage lives in the DB.

---

## Local development

### Prerequisites

- Node.js **22+** (required — tests use `--experimental-strip-types`)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Docker (for local Supabase)

### Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in values (see below)
supabase start
supabase db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page — server-side only, never exposed to the browser |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally, `https://ringmark.org` in production |
| `RINGMARK_API_KEY` | Generate any long random hex string — used to authenticate REST API and MCP calls |

### Creating your auth user (local)

```sql
-- Run in Supabase Studio (localhost:54323) or supabase db execute
UPDATE auth.users
SET encrypted_password = extensions.crypt('YourPassword', extensions.gen_salt('bf', 12))
WHERE email = 'your@email.com';
```

---

## REST API

The REST API at `/api/v1/` provides programmatic access to workshop data. It is the integration layer for LLM tools, the MCP server, and any future client.

**Base URL:** `http://localhost:3000` (dev) · `https://ringmark.org` (production)

**Auth:** Bearer token in every request:

```bash
curl http://localhost:3000/api/v1/objects \
  -H "Authorization: Bearer $RINGMARK_API_KEY"
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/objects` | List objects; filter with `?q`, `?type`, `?status`, `?published`, `?limit`, `?offset` |
| `POST` | `/api/v1/objects` | Create root object; workshop ID + slug auto-generated if omitted |
| `GET` | `/api/v1/objects/:id` | Fetch single object by UUID or workshop ID (case-insensitive) |
| `PATCH` | `/api/v1/objects/:id` | Partial update; whitelisted fields only — `public_slug` is never accepted |
| `DELETE` | `/api/v1/objects/:id` | Delete object (children cascade) |
| `POST` | `/api/v1/objects/:id/children` | Add child with auto flat-numbered workshop ID |

### Interactive docs

The API is self-documenting via OpenAPI 3.1:

- **Swagger UI** — [`/api/v1/docs`](http://localhost:3000/api/v1/docs) — try every endpoint in the browser
- **OpenAPI JSON** — [`/api/v1/openapi.json`](http://localhost:3000/api/v1/openapi.json) — import into Postman, Insomnia, or any OpenAPI tooling

Both endpoints are public (no auth required). The spec is generated at runtime from `lib/api-schemas.ts`, so it is always in sync with the code.

Full reference with curl examples: [`docs/api.md`](docs/api.md)

---

## MCP server

Ringmark ships an MCP server that exposes the REST API as tools for LLM assistants (Claude Desktop, etc.).

### Available tools

| Tool | What it does |
|------|-------------|
| `list_objects` | List recent workshop objects with optional type/status/published filters |
| `search_objects` | Search by title, species, workshop ID, or public title |
| `get_object` | Fetch full details by workshop ID or UUID |
| `create_object` | Create a new root object (workshop ID auto-assigned) |
| `add_child` | Create a child object with flat descendant ID (e.g. `RH1` → `RH1-1`) |
| `update_object` | Update object fields |
| `save_story` | Set public title, narrative, notes, and care instructions |
| `publish_object` | Publish or unpublish an object |

### Claude Desktop setup

The MCP server requires the dev server (or a production deploy) to be running — it calls the REST API via HTTP.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ringmark": {
      "command": "/path/to/ringmark/node_modules/.bin/tsx",
      "args": ["/path/to/ringmark/mcp/index.ts"],
      "cwd": "/path/to/ringmark"
    }
  }
}
```

`RINGMARK_API_KEY` and `RINGMARK_API_URL` are loaded from `.env.local`. Set `RINGMARK_API_URL` to the production URL to use a deployed instance instead of localhost.

---

## Testing

### Unit + security tests (no server needed)

```bash
npm test                # all unit + security
npm run test:unit       # unit only
npm run test:security   # security source-inspection only
```

These cover: workshop ID generation, slug generation, lineage derivation, every server action's ownership verification, auth routing contract, and public page privacy invariants (private fields never leak).

### End-to-end tests (Playwright)

Requires local Supabase and the dev server running.

```bash
supabase start      # terminal 1
npm run dev         # terminal 2
npm run test:e2e    # terminal 3
```

Playwright creates a dedicated `e2e@ringmark.local` test user via the Supabase admin API and cleans up all test data after the run. Your real data is never touched.

```bash
npm run test:e2e:ui   # interactive Playwright UI
npm run test:all      # unit + security + E2E in sequence
```

### API integration tests

```bash
npm run test:api   # Playwright against the running dev server
```

58 tests covering auth, CRUD, search/filter, children, OpenAPI spec, and Swagger UI.

| Suite | What it covers |
|---|---|
| `auth.spec.ts` | Unauthenticated redirects, wrong password, correct login, sign-out, non-owner access |
| `workshop.spec.ts` | Source creation, child/grandchild lineage, flat ID invariant, type/status transforms |
| `story.spec.ts` | Story draft + save, publish/unpublish, round-trip persistence, private_notes leak check |
| `public-page.spec.ts` | Owner redirect to admin, anonymous public page, unpublished placeholder, private field canaries, unknown slug |
| `search.spec.ts` | Exact ID, child ID, title keyword, empty state |
| `delete.spec.ts` | Two-tap confirmation, Cancel, deletion confirmed in search and direct URL |
| `photos.spec.ts` | Photo visibility toggle verified on public page (both directions) |
| `api.spec.ts` | Auth, list/search/filter, create, get, patch, delete, children, OpenAPI endpoints |

### CI

GitHub Actions runs on every push to `main`: unit tests → type check → lint.

---

## Database

```bash
supabase migration new <name>   # create a new migration
supabase db push                # apply pending migrations to local DB
supabase db push --linked       # apply to remote Supabase project
```

Migrations live in `supabase/migrations/`. Never edit applied migrations — always create a new one.

---

## Key commands

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # production build check
npm run lint         # ESLint
npx tsc --noEmit     # TypeScript check
npm run mcp          # run MCP server directly (for debugging)
```

---

## Route structure

```
/                           Admin home + search (auth-gated)
/auth                       Sign in
/objects/new                Create object
/objects/[id]               Object detail
/objects/[id]/edit          Edit all fields
/objects/[id]/child/new     Add child object
/objects/[id]/story         Edit public story + publish/unpublish
/objects/[id]/qr            QR card + download
/p/[slug]                   Public story page (no auth required)
/maker                      Public maker page — published pieces
/api/v1/                    REST API (see above)
/api/v1/docs                Swagger UI
/api/v1/openapi.json        OpenAPI 3.1 spec
```

---

## Security model

1. All mutations go through server actions that call `auth.getUser()` server-side — `account_id` is always derived from the session, never trusted from the client.
2. `/p/[slug]` makes the auth routing decision server-side before rendering anything.
3. Public page queries select only explicitly public fields — `private_notes`, `location_text`, and `workshop_id` are never included.
4. RLS policies are a second layer, not the only layer.
5. Private photo storage paths are never included in public responses.
6. REST API endpoints use `crypto.timingSafeEqual` for key comparison and scope all queries to the account — the service role client is never exposed beyond the route handler.
