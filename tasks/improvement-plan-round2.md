# Ringmark Improvement Plan — Round 2 (Optimization, UX, Refactoring)

Round 1 (`tasks/improvement-plan.md`) is fully implemented — all 15 tasks landed as commits
`fc86c3d..9f33bbd`. This is a fresh audit of the post-round-1 codebase.

Written for a Sonnet builder agent. Each task is self-contained: goal, files, exact steps,
acceptance criteria, and a verify command. Do tasks in order within a phase; finish Phase 1
before Phase 2+ (later tasks assume the correctness fixes are in).

## Ground rules for the implementer

1. **Read every file listed in a task before editing it.** Match existing patterns — no new
   libraries, no new state managers, no abstractions beyond what the task says.
2. **Security invariants (never violate):**
   - Public queries never select `private_notes`, `location_text`, or `workshop_id`.
   - `public_slug` is never written after creation.
   - `account_id` always comes from `getOrCreateAccount()` server-side, never from client input.
   - All mutations stay in server actions or `app/api/v1/` routes.
3. **After every task:** `npx tsc --noEmit` and `npm run build` must pass. Run `npm test`
   after `lib/` changes and the named Playwright specs after action/page changes.
4. **One task = one commit**, semantic message (`fix:`, `perf:`, `refactor:`, `feat:`).
5. If a task's premise doesn't match the code you find (file moved, already fixed), stop and
   note it in this file under the task rather than improvising.

---

## Phase 1 — Correctness (do first)

### Task 1.1 — Fix the broken admin delete path (FK failure, silent error, orphaned storage)
**Bug cluster.** The DB schema (`supabase/migrations/20260614000002_wood_objects.sql:12-13`)
gives `parent_id` and `root_id` FKs **no ON DELETE action** — deleting any object that has
children fails with a raw FK violation. Three consequences today:
1. `deleteObject` in `actions/objects.ts:191` has no children guard (the API route
   `app/api/v1/objects/[id]/route.ts:158-170` correctly 409s — the action doesn't).
2. `DeleteObjectButton` (`components/delete-object-button.tsx`) **swallows** `result.error` —
   the user taps "Yes, delete permanently" and nothing visibly happens.
3. `deleteObject` never removes photo files from storage. `object_photos` rows cascade, but
   the storage objects under `accountId/objectId/` are orphaned forever. (The API DELETE
   route does clean storage — mirror it.)
Also the Danger Zone copy on `app/(admin)/objects/[id]/page.tsx:302-305` claims "Children are
not deleted but become roots" — false; the FK blocks the delete.

- Files: `actions/objects.ts`, `components/delete-object-button.tsx`,
  `app/(admin)/objects/[id]/page.tsx`; read `app/api/v1/objects/[id]/route.ts` DELETE first.
- Steps:
  1. In `deleteObject`: before deleting, query children
     (`select('workshop_id').eq('parent_id', id).eq('account_id', account.id)`). If any,
     return `{ error: 'This object has children (X, Y). Delete or re-parent them first.' }` —
     same behavior as the API route.
  2. Then fetch `object_photos.storage_path` for the object and call
     `supabase.storage.from('object-photos').remove(paths)` best-effort (log failure via
     `console.error`, don't block the delete) — copy the API route's pattern.
  3. In `DeleteObjectButton`: add an `error` state; on `result.error`, set it and render the
     message below the buttons in the existing destructive text style. Keep `setConfirming(false)`.
  4. Fix the Danger Zone paragraph: "Permanently deletes this object and all its photos.
     Objects with children can't be deleted — delete or re-parent the children first."
- Accept: deleting a leaf works and removes its storage files; deleting a parent shows the
  children message inline; no silent no-op remains.
- Verify: `npx playwright test e2e/delete.spec.ts`; add a spec case for the
  has-children error message if not covered.

### Task 1.2 — Re-parenting: cycle guard + descendant `root_id` cascade + scoped parent lookups
**Bug.** `updateObject` (`actions/objects.ts:153-167`) recomputes `root_id` for the moved
object only. Its descendants keep the **old** `root_id`, which breaks the `/p/[slug]` lineage
query (`.eq('root_id', ...)`), the workshop rollup, and the tree page. Worse, there is no
cycle check: `ParentSearch` in the edit form only excludes the object itself, so setting an
object's parent to its own descendant is accepted — and the chain walk in
`app/p/[slug]/page.tsx:127-133` would then loop forever (server hang on the public page).
Also: the parent lookups in `createObject` (line ~47) and `updateObject` (line ~159) are not
scoped to `account_id` — RLS saves us, but CLAUDE.md says RLS is a second layer, not the only one.

- Files: `lib/lineage-utils.ts`, `actions/objects.ts`, `__tests__/unit/lineage.test.ts`,
  `app/p/[slug]/page.tsx`
- Steps:
  1. In `lib/lineage-utils.ts` add a pure helper:
     `collectSubtreeIds(rows: { id: string; parent_id: string | null }[], startId: string): Set<string>`
     — build a parent→children map, BFS from `startId`, include `startId`. Unit-test it in
     `__tests__/unit/lineage.test.ts` (linear chain, branching, node not in rows, cycle in
     input terminates via a visited set).
  2. In `updateObject`, when `'parent_id' in data` and the new parent is non-null:
     a. Fetch the current subtree: `select('id, parent_id').eq('account_id', account.id)`
        filtered to the object's current `root_id` (add `root_id` to the initial ownership
        select; if `root_id` is null, fall back to fetching all account rows — legacy data).
     b. `const subtree = collectSubtreeIds(rows, id)`. If `subtree.has(newParentId)`, return
        `{ error: 'Cannot set parent to this object or one of its descendants.' }`.
  3. After the main update succeeds and `parent_id` changed: update descendants' root_id in
     one query — `update({ root_id: <newRootId> }).in('id', [...subtree].filter(x => x !== id)).eq('account_id', account.id)`
     where `<newRootId>` is the same value written to the moved object.
  4. Add `.eq('account_id', account.id)` to the parent lookups in both `createObject` and
     `updateObject`.
  5. Safety net in `app/p/[slug]/page.tsx`: add a `visited` Set to the chain walk so a bad
     row can never infinite-loop the public page (break if already visited).
- Accept: re-parenting a node moves its whole subtree's `root_id`; parenting to a descendant
  is rejected with a clear message; parent lookups are account-scoped; the public-page walk
  is loop-proof.
- Verify: `npm test` (new lineage tests); `npx playwright test e2e/workshop.spec.ts e2e/public-page.spec.ts`.

### Task 1.3 — Sanitize search input used in PostgREST `.or()` / `ilike` filters
**Bug.** User search text is interpolated raw into PostgREST filter strings:
- `app/(admin)/workshop/page.tsx:61` — `.or(\`workshop_id_lower.ilike.%${query}%,title.ilike.%${query}%\`)`
- `app/api/v1/objects/route.ts:38` — same pattern with 4 fields.
A query containing `,`, `(`, or `)` breaks the filter syntax (500/empty results for legit
searches like `bowl, maple`), and `%`/`_` act as unintended wildcards. This is not SQL
injection and can't cross the account scope (the `.eq('account_id')` is a separate ANDed
filter), but it breaks search and is sloppy input handling.

- Files: `lib/utils.ts` (or a new `lib/search-sanitize.ts` if utils is crowded),
  `app/(admin)/workshop/page.tsx`, `app/api/v1/objects/route.ts`, `actions/objects.ts:237`,
  new tests in `__tests__/unit/`
- Steps:
  1. Add `export function sanitizeSearch(q: string): string` — trim, cap at 100 chars,
     strip the PostgREST structural chars `, ( ) "`, and escape ilike wildcards:
     `\` → `\\`, `%` → `\%`, `_` → `\_`.
  2. Apply it to the user-supplied term in all three call sites before building the filter
     string (`searchObjects` only needs the wildcard escaping — it uses `.ilike()` directly).
  3. Unit test: commas/parens removed, wildcards escaped, plain queries untouched.
- Accept: searching `bowl, maple` or `50%` returns sane results instead of erroring or
  matching everything; no behavior change for plain alphanumeric queries.
- Verify: `npm test`; `npx playwright test e2e/search.spec.ts e2e/api.spec.ts`.

### Task 1.4 — Revalidate the pages that actually changed
**Bug.** `actions/objects.ts` still calls `revalidatePath('/')` — a leftover from when `/`
was the admin home. The admin list now lives at `/workshop`, so after create/update/delete
the workshop list can serve stale cache. `updateObject` also never revalidates the public
page even though it can change `public_story`/`is_published` etc.

- Files: `actions/objects.ts` (read `actions/story.ts` first to match its revalidation pattern)
- Steps:
  1. Replace every `revalidatePath('/')` in `actions/objects.ts` with `revalidatePath('/workshop')`.
  2. In `updateObject`, add `public_slug` to the ownership select and, after a successful
     update, `revalidatePath(\`/p/${existing.public_slug}\`)`.
  3. `deleteObject`: also revalidate `/workshop` (and the object's `/p/` slug — fetch it in
     the pre-delete select added in Task 1.1).
- Accept: creating/editing/deleting an object refreshes `/workshop` and the piece's public
  page without a manual reload.
- Verify: `npx playwright test e2e/workshop.spec.ts e2e/story.spec.ts`.

---

## Phase 2 — Performance

### Task 2.1 — Pipeline photo uploads (resize + upload concurrently, records in order)
**Problem.** `components/photo-section.tsx:54-87` processes files strictly one at a time:
resize → upload → DB record → next. A 6-photo batch on workshop wifi serializes everything.
Note: `createPhotoRecord` assigns `sort_order` via a max-query, so DB records must stay
sequential/ordered — parallelize only the resize+upload part.

- Files: `components/photo-section.tsx`
- Steps:
  1. Phase A (concurrent, limit 3): for all files, run `resizeImage` + `supabase.storage.upload`
     with a simple concurrency limiter (a small inline `mapWithConcurrency` helper — no new
     deps). Collect per-file results `{ path } | { error }` in input order. Update
     `uploadCount.done` as each finishes.
  2. Phase B (sequential, in input order): for each successful upload, `await createPhotoRecord(...)`.
     This preserves today's sort-order semantics exactly.
  3. Keep per-file error behavior: a failed resize/upload records the error message (show the
     first error via `uploadError`) and skips that file; it must not abort the batch.
     A failed `createPhotoRecord` should stop Phase B (matches current behavior) but photos
     already recorded stay.
- Accept: multi-file uploads are visibly faster; photo order still matches selection order;
  one bad file doesn't kill the batch.
- Verify: `npx playwright test e2e/photos.spec.ts`; manual: select 5 large images at once.

### Task 2.2 — Parallelize the workshop page's count + roots queries
**Problem.** `app/(admin)/workshop/page.tsx:66-81` runs the root-count query and the paged
roots query sequentially; they're independent.

- Files: `app/(admin)/workshop/page.tsx`
- Steps: wrap the `count` query and the `pagedRoots` query in one `Promise.all`. The children
  query stays after (depends on `pagedRoots`).
- Accept: same rendered output, one fewer sequential round trip.
- Verify: `npx playwright test e2e/workshop.spec.ts`.

---

## Phase 3 — Refactoring (behavior-neutral)

### Task 3.1 — Small cleanups pass (single commit)
All mechanical; no behavior change:
1. `app/p/[slug]/page.tsx:102-104` — the comment still describes the old per-ancestor query
   loop ("We query each ancestor individually…"). Rewrite to describe the single root_id
   query + in-memory walk.
2. `app/p/[slug]/page.tsx:105-115` — `ChainStep` declares `workshop_id: string` but the
   select never fetches it (the `as ChainStep` cast hides this). Remove `workshop_id` from
   the type. Also remove the pointless `const displaySteps = steps` alias (line ~198) — use
   `steps` directly.
3. `app/(admin)/objects/[id]/page.tsx:54` — hardcoded `3600`; import and use
   `SIGNED_URL_EXPIRY` from `lib/constants.ts`.
4. `app/(admin)/objects/[id]/page.tsx:36-40` — the children query isn't account-scoped; add
   `.eq('account_id', account.id)` (defense in depth, matches the photos query beside it).
5. `app/(admin)/objects/[id]/page.tsx:76` — "← Back" links to `/`, which for a logged-in
   user is a redirect bounce through the landing page. Link straight to `/workshop`.
- Verify: `npx tsc --noEmit`; `npx playwright test e2e/workshop.spec.ts e2e/public-page.spec.ts`.

### Task 3.2 — Extract a shared signed-URL batch helper
**Problem.** The "createSignedUrls → build Map → attach to rows" dance is duplicated in
`app/(admin)/objects/[id]/page.tsx:50-61` and `app/p/[slug]/page.tsx:169-178` (and any future
gallery). Small, real duplication.

- Files: new `lib/signed-urls.ts`; both pages
- Steps:
  1. Export `async function signPathsBatch(storage: SupabaseClient['storage'], bucket: string, paths: string[], expiresIn: number): Promise<Map<string, string>>`
     — returns an empty Map for `paths.length === 0`; skips entries with null `signedUrl`.
     (Type the first param however the two call sites make cleanest — read both first.)
  2. Replace both inline implementations. Rendered output must be identical.
- Accept: one implementation; both pages behave exactly as before.
- Verify: `npx playwright test e2e/photos.spec.ts e2e/public-page.spec.ts`.

### Task 3.3 — Shared `FormField` label wrapper for the three object forms
**Problem.** The `<label className="block text-sm font-medium mb-1.5">X <span …>optional</span></label>`
block is copy-pasted ~15× across `edit-object-form.tsx`, `components/object-form.tsx`, and
the story editor, with the "optional"/"private · optional" annotation reimplemented each time.

- Files: new `components/form-field.tsx`;
  `app/(admin)/objects/[id]/edit/edit-object-form.tsx`, `components/object-form.tsx`,
  `app/(admin)/objects/[id]/story/story-editor.tsx` (read first — only convert if its labels
  match the same pattern)
- Steps: export `FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode })`
  rendering the exact current markup; replace each label+field pair. Do NOT restructure the
  forms' state or submit logic — markup-only refactor.
- Accept: forms render pixel-identical; label markup exists in exactly one place.
- Verify: `npx playwright test e2e/workshop.spec.ts e2e/story.spec.ts`; `npm run build`.

---

## Phase 4 — UX / product polish

### Task 4.1 — OG share card shows the wrong photo
**Bug.** `app/p/[slug]/opengraph-image.tsx:39` fetches the hero photo with
`.order('sort_order', { ascending: false })` — the **last** photo. The page hero
(`app/p/[slug]/page.tsx`) shows the **first** photo (`ascending: true`). A shared link's
preview card therefore shows a different image than the page it opens.

- Files: `app/p/[slug]/opengraph-image.tsx`
- Steps: change to `{ ascending: true }` so the OG card matches the page hero. While there,
  check `app/maker/opengraph-image.tsx` for the same pattern and align it if applicable.
- Accept: the OG card photo is the same photo as the public page hero.
- Verify: `npm run build`; manual: hit `/p/<slug>/opengraph-image` in the dev server and
  compare with the page hero.

### Task 4.2 — Surface caption/visibility/move errors in the photo grid
**Problem.** In `components/photo-section.tsx`, `handleSaveCaption`, `handleToggleVisibility`,
and `handleMove` ignore the actions' `{ error }` results — a failed toggle just silently does
nothing after the refresh.

- Files: `components/photo-section.tsx`
- Steps: capture each action's result; on `result.error`, set the existing `uploadError`
  state (rename it `actionError` if you touch every usage; otherwise reuse as-is). Clear it
  on the next successful action.
- Accept: any failed photo action shows its message in the existing error slot.
- Verify: `npx playwright test e2e/photos.spec.ts`.

---

## Explicitly out of scope (don't do these)

- Caching/ISR for `/p/[slug]` — still blocked on splitting the owner banner from cacheable
  content; needs a design decision first.
- Changing the `parent_id`/`root_id` FKs to `ON DELETE CASCADE`/`SET NULL` via migration —
  the Task 1.1 application-level guard is the intended behavior (explicit, no surprise mass
  deletes). Revisit only if Rafe asks for cascade semantics.
- Merging the create form (`object-form.tsx`) and edit form into one component — they differ
  enough (parent search, extra fields, gating) that the merge costs more than it saves.
- Drag-and-drop photo reorder; any change to slug generation, workshop-ID numbering, or API
  auth. No new dependencies of any kind.

## Completion checklist (run once, at the end)

```bash
npx tsc --noEmit && npm run lint && npm run build && npm test && npm run test:api
```

All green, plus the full Playwright suite if time allows (`npx playwright test`).
