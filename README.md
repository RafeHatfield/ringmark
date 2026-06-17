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

### Creating your auth user (local)

```sql
-- Run in Supabase Studio (localhost:54323) or supabase db execute
UPDATE auth.users
SET encrypted_password = extensions.crypt('YourPassword', extensions.gen_salt('bf', 12))
WHERE email = 'your@email.com';
```

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
supabase start     # terminal 1
npm run dev        # terminal 2
npm run test:e2e   # terminal 3
```

Playwright creates a dedicated `e2e@ringmark.local` test user via the Supabase admin API and cleans up all test data after the run. Your real data is never touched.

```bash
npm run test:e2e:ui   # interactive Playwright UI
npm run test:all      # unit + security + E2E in sequence
```

| Suite | What it covers |
|---|---|
| `auth.spec.ts` | Unauthenticated redirects, wrong password, correct login, already-logged-in redirect, sign-out, non-owner access |
| `workshop.spec.ts` | Source creation, child/grandchild lineage, flat ID invariant, type/status transforms |
| `story.spec.ts` | Story draft + save, publish/unpublish, round-trip persistence, private_notes leak check |
| `public-page.spec.ts` | Owner redirect to admin, anonymous public page, unpublished placeholder, all private field canaries, unknown slug |
| `search.spec.ts` | Exact ID, child ID, title keyword, empty state |
| `delete.spec.ts` | Two-tap confirmation, Cancel, deletion confirmed in search and direct URL |
| `photos.spec.ts` | Photo visibility toggle verified on public page (both directions) |

### CI

GitHub Actions runs on every push to `main`: unit tests → type check → lint. E2E tests run locally only (Supabase-in-CI reliability is not yet worth the overhead for a single-user project).

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
```

---

## Security model

1. All mutations go through server actions that call `auth.getUser()` server-side — `account_id` is always derived from the session, never trusted from the client.
2. `/p/[slug]` makes the auth routing decision server-side before rendering anything.
3. Public page queries select only explicitly public fields — `private_notes`, `location_text`, and `workshop_id` are never included.
4. RLS policies are a second layer, not the only layer.
5. Private photo storage paths are never included in public responses.
