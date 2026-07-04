# Ringmark Improvement Plan — Optimization, UX, Refactoring

Written for a Sonnet builder agent. Each task is self-contained: goal, files, exact steps,
acceptance criteria, and a verify command. Do the tasks in order within a phase; phases 1–2
before phase 3 (refactors assume the behavior fixes are in).

## Ground rules for the implementer

1. **Read every file listed in a task before editing it.** Match existing patterns — don't
   introduce new libraries, new state managers, or new abstractions beyond what the task says.
2. **Security invariants (never violate):**
   - Public queries never select `private_notes`, `location_text`, or `workshop_id`.
   - `public_slug` is never written after creation.
   - `account_id` always comes from `getOrCreateAccount()` server-side, never from client input.
   - All mutations stay in server actions or `app/api/v1/` routes.
3. **After every task:** `npx tsc --noEmit` must pass and `npm run build` must pass.
   Run `npm test` (unit) after lib/ changes and `npm run test:api` after action/API changes.
4. **One task = one commit**, semantic message (`fix:`, `perf:`, `refactor:`, `feat:`).
5. If a task's premise doesn't match the code you find (file moved, already fixed), stop and
   note it in this file under the task rather than improvising.

---

## Phase 1 — Correctness (do first, small diffs)

### Task 1.1 — Scope the legacy `/maker` page to a single account
**Bug:** `app/maker/page.tsx` picks the oldest account (`order created_at limit 1`) but then
lists **all published pieces from every account** — the pieces query has no `account_id`
filter. With multi-user accounts live, one maker's page shows other makers' work.

- Files: `app/maker/page.tsx`
- Steps:
  1. In both `generateMetadata` and the page component, after fetching the account, add
     `.eq('account_id', account.id)` to the `wood_objects` query (fetch `id` in the account
     select; the metadata query doesn't need pieces).
  2. If the account has a `handle`, `redirect()` (from `next/navigation`, permanent via
     `permanentRedirect`) to `/${handle}/maker` instead of rendering — the sitemap already
     prefers handle URLs, and Task 3.1 dedupes the rest.
- Accept: `/maker` never renders pieces from a second account; with a handle set it 308s to
  `/{handle}/maker`.
- Verify: `npm run build`; e2e `npx playwright test e2e/maker.spec.ts`.

### Task 1.2 — Point the public story page's maker link at the handle URL
**Bug:** `app/p/[slug]/page.tsx:354` links "From the workshop of {name}" to `/maker`
(global legacy route) regardless of which account owns the piece.

- Files: `app/p/[slug]/page.tsx`
- Steps:
  1. Add `handle` to the `accounts` select in Round 2 (line ~87).
  2. Link to `` `/${accountData.handle}/maker` `` when `handle` is set; fall back to `/maker`.
- Accept: a published piece from an account with a handle links to `/{handle}/maker`.
- Verify: `npx playwright test e2e/public-page.spec.ts`.

### Task 1.3 — Make the child form actually inherit species from the parent
**Bug:** `child-object-form.tsx` species placeholder says "Inherits from parent if blank",
and the API route (`app/api/v1/objects/[id]/children/route.ts:66`) does inherit
(`species?.trim() || parent.species`) — but the server action path (`createObject` in
`actions/objects.ts`) does not. UI-created children silently get `species: null`.

- Files: `actions/objects.ts`
- Steps:
  1. In `createObject`, the existing parent lookup (line ~46) already fetches the parent when
     `parent_id` is set — extend its select to `root_id, species`.
  2. When `parent_id` is set and `data.species` is blank, use the parent's species (and leave
     `species_confidence` null).
- Accept: creating a child via the UI with species left blank stores the parent's species;
  explicit species still wins. Behavior now matches the API route.
- Verify: `npm run test:api` and `npx playwright test e2e/workshop.spec.ts`.

---

## Phase 2 — Performance

### Task 2.1 — Replace the N+1 ancestor walk on `/p/[slug]` with one query
**Problem:** `app/p/[slug]/page.tsx:112-127` walks `parent_id` with one DB round trip per
ancestor. A 6-step lineage = 6 sequential queries on the highest-traffic public page.
`root_id` exists on every row, so the whole tree is one query.

- Files: `app/p/[slug]/page.tsx`
- Steps:
  1. Add `root_id` to the leaf object select (Round 1).
  2. Replace the while-loop with a single query:
     `admin.from('wood_objects').select('id, parent_id, object_type, title, public_story, public_notes, public_care, species').eq('root_id', object.root_id ?? object.id).eq('account_id', object.account_id)`.
  3. Build the chain in memory: put rows in a `Map<id, row>`, then walk from `object.id` up
     via `parent_id` exactly as before, `unshift`-ing into `chain`. Keep the existing
     `ChainStep` type and everything downstream unchanged.
  4. Handle the legacy case `root_id === null`: fall back to a chain of just the leaf.
- Accept: rendered page identical (same steps, same order); DB round trips for lineage drop
  from N to 1. The photos and signed-URL batching below it are already batched — don't touch.
- Verify: `npx playwright test e2e/public-page.spec.ts e2e/story.spec.ts`.

### Task 2.2 — Deduplicate per-request account/auth lookups with React `cache()`
**Problem:** `getOrCreateAccount()` (`lib/supabase/account.ts`) runs `auth.getUser()` +
membership + account queries. The admin layout calls it, then every admin page calls it
again — 6+ queries per page view. Same for `createClient()` consumers and the duplicated
object fetch in `/p/[slug]`'s `generateMetadata` vs page body.

- Files: `lib/supabase/account.ts`, `app/p/[slug]/page.tsx`
- Steps:
  1. Wrap `getOrCreateAccount` in `cache()` from `react`:
     `export const getOrCreateAccount = cache(async (): Promise<Account> => { ... })`.
     This memoizes per request across layout + page. No caller changes needed.
  2. In `app/p/[slug]/page.tsx`, extract a module-level
     `const getPublishedObject = cache(async (slug: string) => ...)` used by both
     `generateMetadata` and the page for the leaf-object + account lookups, so metadata
     generation stops issuing its own duplicate queries. Keep the selects exactly as-is
     (public fields only) — merge the two selects into one that satisfies both callers.
- Accept: one membership/account lookup per admin request; one leaf-object query per public
  page request. No behavior change.
- Verify: `npx tsc --noEmit`; `npx playwright test e2e/auth.spec.ts e2e/public-page.spec.ts`.

### Task 2.3 — Parallelize object-detail queries
**Problem:** `app/(admin)/objects/[id]/page.tsx:28-50` fetches parent, children, and photos
sequentially after the object; they're independent.

- Files: `app/(admin)/objects/[id]/page.tsx`
- Steps: after the `object` fetch, wrap the parent, children, and photos queries in one
  `Promise.all`. Signed-URL generation stays after (depends on photos).
- Accept: same rendered output; 3 round trips collapse into 1 parallel wave.
- Verify: `npx playwright test e2e/workshop.spec.ts e2e/photos.spec.ts`.

### Task 2.4 — Downscale photos client-side before upload
**Problem:** `components/photo-section.tsx` uploads phone originals (5–12 MB) untouched.
Uploads are slow on workshop wifi, storage grows fast, and every public-page hero pulls a
multi-MB source through the image optimizer. Also `accept` includes `image/heic`, which
Chrome/Firefox can't render once served back.

- Files: `components/photo-section.tsx`, new `lib/image-resize.ts`
- Steps:
  1. Create `lib/image-resize.ts` exporting
     `async function resizeImage(file: File, maxDim = 2048, quality = 0.85): Promise<Blob>`:
     `createImageBitmap(file)` → draw onto a canvas scaled so the longest edge ≤ `maxDim` →
     `canvas.toBlob('image/jpeg', quality)`. If `createImageBitmap` throws (unsupported
     format), rethrow with a clear message. No new dependencies.
  2. In `handleFiles`, resize each file before upload; always upload as `.jpg`
     (`{ contentType: 'image/jpeg' }`). If resize fails for a file, surface the error via the
     existing `uploadError` state and skip that file rather than aborting the batch.
  3. Remove `image/heic` from `accept` on non-Safari? No — keep `accept` as-is; iOS Safari
     converts HEIC through `createImageBitmap`/canvas to JPEG, which is the point of step 2.
  4. Move the `createBrowserClient(...)` call out of the component body to module scope
     (it's currently re-created every render).
- Accept: uploaded storage objects are JPEG ≤ 2048px longest edge; HEIC picked on iOS lands
  as JPEG; a corrupt file errors per-file without killing the batch.
- Verify: `npx playwright test e2e/photos.spec.ts`; manual: upload a large PNG, confirm the
  stored object is a JPEG under ~1 MB.

### Task 2.5 — Drop the redundant `public_slug` lookup in photo actions
**Problem:** every action in `actions/photos.ts` does a third query just to fetch
`public_slug` for `revalidatePath`, after already fetching the photo/object.

- Files: `actions/photos.ts`
- Steps: in each action's ownership-check select, join the slug in one query — for photo
  lookups use `select('id, storage_path, object_id, wood_objects(public_slug)')` (FK join);
  for `createPhotoRecord` add `public_slug` to the object ownership select. Delete the
  trailing `wood_objects` queries. Keep the revalidate calls identical.
- Accept: each photo action performs one fewer query; revalidation behavior unchanged.
- Verify: `npx playwright test e2e/photos.spec.ts`.

---

## Phase 3 — Refactoring (behavior-neutral; do after phases 1–2)

### Task 3.1 — Extract a shared `MakerProfile` component
**Problem:** `app/maker/page.tsx` and `app/[handle]/maker/page.tsx` are ~200-line
near-duplicates (styles, JSON-LD, header, pieces list, footer, `RingsIcon`).

- Files: new `components/maker-profile.tsx`; both maker pages
- Steps:
  1. Create `components/maker-profile.tsx` (server component) exporting
     `MakerProfile({ account, pieces, canonicalUrl })` — everything from the `<style>` block
     to the footer, including JSON-LD and `RingsIcon`. Props typed from the existing selects.
  2. Reduce both pages to: fetch account + pieces (keeping their different lookups — oldest
     account vs `eq('handle', ...)` — and the Task 1.1 scoping/redirect), then render
     `<MakerProfile ... />`. Keep each page's `generateMetadata` (they differ only in URL —
     extract a small shared `makerMetadata(account, url)` helper into the same file).
- Accept: both routes render pixel-identical to before; combined page code shrinks by
  roughly 300 lines; no duplicated JSX remains.
- Verify: `npx playwright test e2e/maker.spec.ts`; `npm run build`.

### Task 3.2 — Extract a shared object form
**Problem:** `new-object-form.tsx` and `child-object-form.tsx` duplicate ~80%: `fieldClass`,
workshop-ID sanitize/availability-check handlers, type/status/title/species fields, error
handling, cancel/save footer.

- Files: new `components/object-form.tsx`; both form files
- Steps:
  1. Create `components/object-form.tsx` (client) owning all shared state + submit. Props:
     `{ suggestedId, defaultType?, parent?: { id, workshopId } }`. Behavior differences to
     preserve exactly:
     - Parent variant shows the "Child of" banner, always shows status, shows the
       "Step notes" textarea (submitted as `public_story`), species placeholder
       "Inherits from parent if blank", cancel goes to `/objects/${parent.id}`.
     - Root variant reveals fields only after a type is chosen (`hasType` gate), hides
       status for `source`, shows the species-confidence select, cancel is `router.back()`.
  2. Reduce `new-object-form.tsx` and `child-object-form.tsx` to thin wrappers (or update
     their `page.tsx` imports to use `ObjectForm` directly and delete the old files —
     prefer deletion).
  3. Move `fieldClass` into the shared component; export it if other forms want it later.
- Accept: both create flows behave exactly as before (gating, placeholders, cancel targets,
  step-notes → `public_story`); duplicate code removed.
- Verify: `npx playwright test e2e/workshop.spec.ts`; `npx tsc --noEmit`.

### Task 3.3 — Centralize object-type label lookup
**Problem:** `OBJECT_TYPES.find((t) => t.value === x)?.label ?? x` is re-implemented in the
object detail page (3×), workshop page, and `/p/[slug]` builds its own `TYPE_LABELS` map.

- Files: `lib/constants.ts` (add `export function typeLabel(value: string): string`),
  `app/(admin)/objects/[id]/page.tsx`, `app/(admin)/workshop/page.tsx`,
  `app/p/[slug]/page.tsx`, plus any other hits from
  `grep -rn "OBJECT_TYPES.find" app components`
- Steps: add the helper (module-level `Map` built once), replace every inline lookup.
- Accept: no remaining inline `.find(...)?.label` lookups; unit test added in
  `__tests__/unit/constants.test.ts` covering known type + unknown fallback.
- Verify: `npm test`; `npx tsc --noEmit`.

### Task 3.4 — Shared public-page chrome (rings icon + footer)
**Problem:** the rings SVG is copy-pasted 7+ times (landing, public page, maker pages,
footers) with slightly different sizes; the "Tracked with Ringmark" footer is duplicated on
every public page.

- Files: new `components/public-chrome.tsx`; `app/p/[slug]/page.tsx`, maker pages (via
  Task 3.1's component), `app/page.tsx`
- Steps: export `RingsIcon({ size, stroke? })` and `PublicFooter()` from one file; replace
  the inline copies. Match each call site's current size/stroke exactly via props.
- Accept: no inline rings-SVG duplicates outside the shared file; visual output unchanged.
- Verify: `npm run build`; spot-check `/`, `/p/[slug]`, maker page.

---

## Phase 4 — UX polish

### Task 4.1 — Use `next/image` in the admin photo grid
**Problem:** `components/photo-section.tsx` renders raw `<img>` (eslint-disabled) — no
lazy loading, no responsive sizing; a 20-photo object loads every original signed URL.

- Files: `components/photo-section.tsx`
- Steps: swap to `<Image fill sizes="(max-width: 672px) 50vw, 336px" className="object-cover" />`
  inside the existing `aspect-square relative` wrapper. `next.config.ts` already allows
  `*.supabase.co/storage/v1/object/**`, which covers signed URLs.
- Accept: grid renders identically; images lazy-load and are served resized.
- Verify: `npx playwright test e2e/photos.spec.ts`.

### Task 4.2 — Add loading skeletons for object detail and public page
**Problem:** `(admin)/objects/[id]/loading.tsx` exists, but `/p/[slug]` (QR-scan entry
point, slowest page) and `/workshop` navigations show a blank screen while server queries
run.

- Files: new `app/p/[slug]/loading.tsx`, new `app/(admin)/workshop/loading.tsx`
- Steps: minimal skeletons matching each page's layout shell (paper background, hero
  aspect-box + title bar for `/p`; search bar + list rows for workshop). Copy the pattern
  from the existing `app/(admin)/objects/[id]/loading.tsx`.
- Accept: navigating to either route shows the skeleton immediately.
- Verify: `npm run build`; manual check with dev server.

### Task 4.3 — Replace `confirm()` dialogs with the existing dialog pattern
**Problem:** photo delete (`photo-section.tsx:82`) uses `window.confirm`, while object
delete has a proper styled `DeleteObjectButton`. Inconsistent, and `confirm()` looks broken
inside standalone/PWA contexts.

- Files: `components/photo-section.tsx`, read `components/delete-object-button.tsx` first
  and reuse its confirm pattern (inline two-step confirm or shadcn dialog — match whatever
  it does).
- Accept: photo delete uses the same confirm affordance as object delete; no `window.confirm`
  left in `components/`.
- Verify: `npx playwright test e2e/photos.spec.ts e2e/delete.spec.ts`.

---

## Explicitly out of scope (don't do these)

- Caching/ISR for `/p/[slug]` — it's per-request dynamic because of the owner check; solving
  that means splitting owner banner from cached content and needs a design decision first.
- Drag-and-drop photo reorder — spec says arrows are sufficient.
- Any change to slug generation, workshop-ID numbering, or the API auth model.
- New dependencies of any kind.

## Completion checklist (run once, at the end)

```bash
npx tsc --noEmit && npm run lint && npm run build && npm test && npm run test:api
```

All green, plus the full Playwright e2e suite if time allows (`npx playwright test`).
