# Ringmark

Mobile-first web app for woodturners to track wood from source to finished piece and share that story with buyers.

**Stack:** Next.js 15 App Router · Supabase (Postgres + Auth + Storage) · shadcn/ui · Tailwind CSS · TypeScript strict

---

## What it does

Each piece of wood gets a short workshop ID (written with a Sharpie) and a QR code that points to a permanent public URL. The same URL routes to two different experiences:

- **Logged-in owner** → full admin view for editing
- **Anyone else** → public story page (photos, species, source story, care instructions)

Objects move through a lifecycle: source → log → blank → rough bowl → finished bowl. A physical transformation (blank → bowl) updates the **same record**. A physical split (one log → two blanks) creates **child records** with flat IDs under the root — `RH1-3`, never `RH1-1-1`.

---

## Local development

### Prerequisites

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### Setup

```bash
# Install dependencies
npm install

# Copy env template and fill in values from your Supabase project dashboard
cp .env.local.example .env.local

# Start local Supabase
supabase start

# Push the schema
supabase db push

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Auth is email + password — set your password in the Supabase dashboard or via the SQL editor:

```sql
UPDATE auth.users
SET encrypted_password = extensions.crypt('YourPassword', extensions.gen_salt('bf', 12))
WHERE email = 'your@email.com';
```

### Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — server-side only, never exposed to the browser |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` in dev, `https://ringmark.org` in production |

---

## Testing

### Unit + security tests (fast, no server required)

```bash
npm test
```

Covers: workshop ID generation, slug generation, lineage derivation, action ownership checks (every mutation verifies session before touching the DB), auth routing contract, public page privacy invariants, manifest file integrity.

```bash
npm run test:unit      # unit tests only
npm run test:security  # security source-inspection tests only
```

### End-to-end tests (Playwright, requires running server)

```bash
# 1. Make sure local Supabase is running
supabase start

# 2. Start the dev server (separate terminal)
npm run dev

# 3. Run the full E2E suite
npm run test:e2e
```

Playwright creates a dedicated `e2e@ringmark.local` test user via the Supabase admin API, runs all tests, then cleans up all test data. Your real data is never touched.

```bash
# Interactive mode — opens the Playwright UI with browser visible
npm run test:e2e:ui
```

#### What the E2E tests cover

| Suite | Coverage |
|---|---|
| `auth.spec.ts` | Unauthenticated redirect, wrong password shows error, correct login, already-logged-in redirect |
| `workshop.spec.ts` | Source creation, child/grandchild lineage, flat ID invariant, type/status transform |
| `story.spec.ts` | Story draft + save, publish, round-trip persistence, private_notes leak check |
| `public-page.spec.ts` | Owner redirect to admin, anonymous public page, unpublished placeholder, private field leak, unknown slug |
| `search.spec.ts` | Exact ID, partial ID, title keyword, empty state |
| `delete.spec.ts` | Two-tap confirmation, Cancel, deletion, object gone from search and direct URL |

### Run everything

```bash
npm run test:all   # unit + security + E2E in sequence
```

### Manual QA checklist

See [`docs/QA.md`](docs/QA.md) for the full manual checklist to run against production after each deploy.

---

## Project commands

```bash
npm run dev          # dev server (localhost:3000)
npm run build        # production build
npm run lint         # ESLint
npx tsc --noEmit     # TypeScript check

supabase start       # start local Supabase
supabase db push     # apply migrations
supabase migration new <name>   # create a migration
```

---

## Route structure

```
/                           Admin home / search (auth-gated)
/auth                       Sign in
/objects/new                Create object
/objects/[id]               Object detail (main admin screen)
/objects/[id]/edit          Edit all fields
/objects/[id]/child/new     Add child object
/objects/[id]/story         Edit public story + publish
/objects/[id]/qr            QR card + download
/p/[slug]                   Public story page (no auth required)
```

The `/p/[slug]` route makes the auth routing decision server-side before rendering anything — logged-in owners are redirected to the admin view, everyone else sees the public page (if published) or a placeholder (if not).
