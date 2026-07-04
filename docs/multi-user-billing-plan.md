# Ringmark multi-user + freemium billing: architecture plan

> Produced by Claude Opus, 2026-06-29. Grounded in the actual codebase — not a generic template.

---

## What's already done (don't re-build)

`account_members`, `account_invites`, the `claim_account_invite` PLPGSQL function, and membership-based RLS are already in migrations. `getOrCreateAccount()` already resolves via `account_members`, not a direct owner check. Two separate test accounts exist in the E2E fixtures. The gaps are billing enforcement, auth UX for new signups, per-account API keys, and the cross-account test suite.

---

## 1. Multi-user data model

### What stays the same

The `account_id` FK pattern on `wood_objects` and `object_photos` is correct as-is. Every content row is already scoped by account.

### Schema gaps to close

**Add billing columns to `accounts`** (one migration):

```sql
alter table accounts
  add column plan                   text not null default 'free'
                                    check (plan in ('free', 'pro')),
  add column stripe_customer_id     text unique,
  add column stripe_subscription_id text unique,
  add column subscription_status    text
                                    check (subscription_status in
                                      ('active','past_due','canceled','trialing',null)),
  add column free_tier_limit        int not null default 20,
  add column root_object_count      int not null default 0;
```

`root_object_count` is a cached counter maintained by a DB trigger (not computed on each request). `free_tier_limit` is per-account so grandfathered users or promotions can be handled without code changes.

**Add `role` to `account_members`:**

```sql
alter table account_members
  add column role text not null default 'member'
             check (role in ('owner', 'member'));
```

**New `api_keys` table** (replaces the env var):

```sql
create table api_keys (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  key_hash      text not null unique,   -- SHA-256, never stored raw
  key_prefix    text not null,          -- first 8 chars shown in UI
  label         text,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- RLS
alter table api_keys enable row level security;

create policy "api_keys: members can read"
  on api_keys for select to authenticated
  using (account_id in (
    select account_id from account_members where user_id = auth.uid()
  ));

create policy "api_keys: members can create"
  on api_keys for insert to authenticated
  with check (account_id in (
    select account_id from account_members where user_id = auth.uid()
  ) and created_by = auth.uid());

create policy "api_keys: owners can revoke"
  on api_keys for delete to authenticated
  using (account_id in (
    select account_id from account_members
    where user_id = auth.uid() and role = 'owner'
  ));
```

### Storage policy gap (live issue today)

The `object-photos` bucket policies currently check `owner_user_id` directly instead of joining through `account_members`. Invited members cannot upload or delete photos. Fix: swap the path-prefix check to join through `account_members`.

### Auth changes

Current setup is already password-based and works for multiple users. Changes needed:

- **Add `/signup` route** — thin wrapper calling `supabase.auth.signUp()`; `getOrCreateAccount()` fires on first login as it does today.
- **Magic link recommendation**: switch to magic link. Eliminates forgot-password flow. Supabase handles it identically from the app's perspective; only `global-setup.ts` changes.
- **Email verification** should gate *upgrades to paid*, not account creation.

---

## 2. Roles and permissions

**Model: owner + member only at launch.**

- **Owner**: created the account. Manages billing, API keys, invites, account deletion.
- **Member**: full workshop access (objects, photos, stories). No billing access.

The existing invite flow (`account_invites` → `claim_account_invite`) gets members into an account. Claimed invites default to `role = 'member'`.

**API keys are per-account, not per-user.** A key authenticates an account. Multiple keys are supported.

`lib/api-auth.ts` and `lib/supabase/service.ts` changes:
- `verifyApiKey()` → hash the incoming key, query `api_keys` where `key_hash = hash AND revoked_at IS NULL`
- `getAccount()` → join through `api_keys` to find the account, instead of returning first account by `created_at`

**Breaking change**: existing `RINGMARK_API_KEY` env var and `MCP_SECRET` stop working. Migration path: one-time script hashes the existing key, inserts it into `api_keys` for the owner account, logs the prefix.

Defer: viewer/read-only role, per-seat pricing, OAuth sign-in.

---

## 3. Freemium billing

### Tier design

- **Free**: up to N root objects (descendants don't count). 20 is the proposed default.
- **Pro**: unlimited roots, $X/month, monthly billing. No annual plan at launch.
- **Grace on lapse**: 7-day grace before re-enforcing the free limit (matches Stripe's retry window).

### Root count: cached trigger

```sql
create or replace function update_root_object_count()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT' and NEW.parent_id is null) then
    update accounts set root_object_count = root_object_count + 1
    where id = NEW.account_id;
  elsif (TG_OP = 'DELETE' and OLD.parent_id is null) then
    update accounts set root_object_count = root_object_count - 1
    where id = OLD.account_id;
  end if;
  return null;
end;
$$;

create trigger trg_root_count_insert
  after insert on wood_objects for each row execute function update_root_object_count();
create trigger trg_root_count_delete
  after delete on wood_objects for each row execute function update_root_object_count();

-- Backfill on migration
update accounts a set root_object_count = (
  select count(*) from wood_objects w
  where w.account_id = a.id and w.parent_id is null
);
```

Deleting a root decrements the counter — free-tier users can free up slots.

### Hard block at create time

HTTP 402 with `{ "error": "free_tier_limit_reached", "limit": 20, "upgrade_url": "..." }`.

Check in exactly two places:
1. `actions/objects.ts` → `createObject`
2. `app/api/v1/objects/route.ts` POST handler

Children are exempt. The `add_child` MCP tool and children REST endpoint need no change.

### Stripe integration

Use **Stripe Checkout** (hosted, no PCI scope) + **Customer Portal** for self-serve management.

New routes:
- `app/(admin)/billing/page.tsx` — plan status, usage bar, upgrade CTA, portal link
- `app/api/stripe/checkout/route.ts` — POST, creates Checkout session, owner-only
- `app/api/stripe/portal/route.ts` — POST, creates Portal session, owner-only
- `app/api/stripe/webhook/route.ts` — POST, no session auth, verified by Stripe signature

Webhook events to handle:

| Event | Action |
|---|---|
| `checkout.session.completed` | `plan = 'pro'`, store customer/subscription IDs, `status = 'active'` |
| `customer.subscription.updated` | Update `subscription_status` |
| `customer.subscription.deleted` | `plan = 'free'`, clear subscription fields |
| `invoice.payment_failed` | `subscription_status = 'past_due'`, no immediate restriction |

New env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

### Billing enforcement by surface

| Surface | Enforcement |
|---|---|
| Admin UI `/objects/new` | Server component shows upgrade CTA in place of form when at limit |
| `createObject` server action | Checks before insert, returns user-facing error |
| `POST /api/v1/objects` | Returns 402 with structured error body |
| MCP `create_object` | Propagates the API 402 as a tool error — no separate check needed |

### Upgrade CTA placement

- Header badge at 80% of limit ("18/20 free roots — upgrade for unlimited")
- Inline block replacing new-object form at the limit
- `/billing` page always in Settings nav

---

## 4. Security

### Defence in depth

RLS is the second layer, not the only one. The application layer always scopes queries by `account_id` derived from the server session or validated API key. The one intentional gap is the `anon read` policy on `wood_objects` (needed for public slug routing) — the application's SELECT list is the only defence there, which is why `private_notes` and `location_text` canary tests are non-negotiable.

### Cross-account leak vectors and mitigations

| Vector | Mitigation |
|---|---|
| `public_slug` collision | Globally unique DB constraint |
| API key leak | Hashed in DB, scoped to one account, easy revocation, `last_used_at` visibility |
| Invite token interception | Single-use, 7-day expiry; worst case: attacker joins legitimate account as member |
| `private_notes`/`location_text` in public queries | Existing E2E canary tests; never loosen them |
| Storage signed URLs | 1-hour expiry, paths not guessable; accepted known limitation |

### Super-admin

Don't build a web-accessible super-admin panel. Use Supabase Studio for data access, Stripe dashboard for billing. If a script is needed, `supabase/scripts/` using the service role key — never deployed as a route.

---

## 5. Test plan

### New test fixtures

- `ensureAccountOnPlan(accountId, plan, rootCount)` — sets billing state via service client without touching Stripe. Essential for deterministic billing tests.
- `createApiKey(accountId)` — generates a key, hashes it, inserts the row, returns the raw key for use in requests.

### Cross-account isolation — `e2e/security-cross-account.spec.ts` (new)

| Test | Expected |
|---|---|
| User B reads user A's object by UUID via admin UI | 404 not-found page |
| User B reads A's object via REST API with B's key | 404 |
| User B patches A's object via REST API | 404 |
| User B deletes A's object via REST API | 404 |
| User B creates a child under A's object | 404 |
| User B uploads a photo to A's object | 404 |
| A's `private_notes` canary not in B's search results | empty results |
| A's API key used against B's resource IDs | 404 (not 401) |

### Billing enforcement — `e2e/billing.spec.ts` (new)

| Scenario | Expected |
|---|---|
| Free account at 0/20 roots | Create root → success |
| Free account at 19/20 roots | Create root → success; next one → 402 |
| Free account at 20/20 roots | `/objects/new` shows upgrade CTA, not form |
| Create child when at free limit | → success (limit doesn't apply to children) |
| Pro account at 100 roots | Create root → success |
| `subscription_status = past_due` | Create root → success (grace period) |
| `subscription_status = canceled` | Treated as free, limit re-enforced |
| Per-account `free_tier_limit = 50`, count = 30 | Create root → success |
| Delete root on free tier | Counter decrements, next create succeeds |

For Stripe webhook tests: construct signed payloads manually using the test webhook secret. Don't hit live Stripe in CI.

### Test file map

| What | File | Tooling |
|---|---|---|
| Cross-account isolation | `e2e/security-cross-account.spec.ts` | Playwright + API |
| Billing enforcement (UI + API) | `e2e/billing.spec.ts` | Playwright |
| API key CRUD + auth | `e2e/api.spec.ts` new describe block | Playwright request |
| Stripe webhook handler | `__tests__/unit/stripe-webhook.test.ts` | Unit, signed payloads |
| Root count trigger correctness | `__tests__/unit/root-count-trigger.test.ts` | Supabase service client |

### Minimum bar before multi-user ships

1. All cross-account isolation cases pass
2. Free-tier hard block at limit (UI + API)
3. `private_notes` and `location_text` canary tests continue passing
4. Wrong API key → 401; right key targeting wrong account's resource → 404; revoked key → 401
5. Non-owner member cannot access `/billing` or generate API keys
6. Storage: account member can upload/delete in their prefix; cannot access another account's prefix

---

## Sequencing

### Phase 1 — Multi-user correctness (no billing yet)

1. Fix storage RLS to use membership join *(live gap)*
2. Add `role` to `account_members`; backfill existing rows to `owner`
3. Add `/signup` route
4. Build `api_keys` table + `/settings/api-keys` management UI
5. Swap `verifyApiKey()` + `getAccount()` from env var to DB lookup
6. Write cross-account isolation test suite

### Phase 2 — Billing

1. Add billing columns + root-count trigger migration
2. Stripe: Checkout, Portal, webhook handler
3. Build `/billing` page
4. Enforce free-tier limit in server action + API route
5. Add upgrade CTAs (header badge + new-object form block)
6. Write billing enforcement test matrix

### Phase 3 — Hardening before open launch

1. Email verification gate on upgrade (not signup)
2. Stripe test-mode webhook tests in CI
3. Invite flow UI (currently API-only — needs a page)

### Defer indefinitely

- Viewer/read-only role
- Annual billing plans
- Per-seat pricing
- Super-admin web panel
- OAuth (Google/Apple) sign-in

---

## Phase 1 adversarial review

> Produced by Claude Opus, 2026-06-29. Codebase-grounded review of edge cases, gaps, and sequencing risks.

Findings are rated: 🔴 Blocking (must fix before task ships) · 🟡 Important (must fix before Phase 1 complete) · 🟢 Nice to have

---

### Task 1: Fix storage RLS

**1.1 — Plan describes a gap that's already half-fixed** 🟡
The `wood_objects` and `object_photos` table RLS was already updated to membership-based policies in migration `20260617000001`. The only remaining gap is the three `storage.objects` policies in `20260614000005_storage.sql` that still check `owner_user_id`. Tighten the task description accordingly. The `avatars` bucket (migration `20260617000002`) already has the correct membership pattern — copy it.

**1.2 — Old and new storage policies will OR together if not dropped first** 🔴
Storage RLS uses permissive (OR'd) policies. If the migration adds new membership-based policies WITHOUT first dropping the old `owner_user_id` ones, both exist simultaneously — dead clutter that makes it impossible to reason about or tighten permissions later. The migration must `DROP POLICY` before creating replacements.

**1.3 — No automated test for the storage fix** 🟡
The REST API photo upload goes through the service-role client (bypasses storage RLS entirely). Storage RLS is only exercised when the user-scoped client uploads directly. Add a test using the user-scoped server client: create a signed upload URL as user B, attempt to upload to user A's account prefix path, assert 403.

---

### Task 2: `role` column on `account_members`

**2.1 — Backfill will set ALL members to `owner`** 🔴
The plan says "backfill existing rows to `owner`" without qualification. This would give invited members owner-level billing access. Correct backfill:

```sql
update account_members am
set role = 'owner'
from accounts a
where am.account_id = a.id
  and am.user_id = a.owner_user_id;
-- All other existing members already have 'member' from the DEFAULT
```

**2.2 — `claim_account_invite()` needs explicit `role = 'member'`** 🟡
The existing INSERT in `claim_account_invite()` omits `role`. With `DEFAULT 'member'` this works, but update the function to include it explicitly for clarity and safety against future migration order issues.

**2.3 — `createInvite()` is not gated to owners — any member can invite** 🟡
`actions/members.ts` calls `getOrCreateAccount()` and inserts an invite with no role check. Any member can generate invite links, bypassing owner control. Fix: after getting the account, verify `role = 'owner'` in `account_members` for the calling user. Gate the button in the settings UI with the same check.

**2.4 — `saveProfile()` silently fails for non-owner members** 🟡
`actions/profile.ts` updates the `accounts` table via the user-scoped client. The "accounts: owner can update" RLS policy still checks `owner_user_id = auth.uid()`. A member's save gets 0 rows updated with no error — silent failure. Fix: update the "accounts: owner can update" and "accounts: owner can delete" policies to check `role = 'owner'` in `account_members` instead of `owner_user_id`. This makes `owner_user_id` a historical record rather than an active auth signal. **The plan doesn't mention these two policies at all — they're the only remaining `owner_user_id`-based policies on `accounts`.**

**2.5 — `getOrCreateAccount()` uses `.single()` — breaks with multi-account membership** 🟢
If a user is ever a member of two accounts, `.single()` errors and falls through to creating a new account. Change to `.maybeSingle()` with `.limit(1)`, or document the deliberate limitation.

---

### Task 3: `/signup` route

**3.1 — `/auth/callback` route exists and works** ~~🔴~~ *false alarm*
`app/auth/callback/route.ts` exists with correct PKCE exchange. Google OAuth is the primary auth method and works in production. Magic link was attempted during initial build, could not be made to work, and was abandoned — keep OAuth + password. No action needed here.

**3.2 — `signUp()` with existing email leaks account existence** 🟡
`supabase.auth.signUp()` with an existing email either returns the user silently (confirmation off) or sends a resend email (confirmation on) — both confirm the account exists. Display the same generic message regardless: "If this is a new account, check your email for a confirmation link."

**3.3 — Settings page copy mentions Google sign-in as invite path** 🟢
`app/(admin)/settings/page.tsx` says "create a Ringmark account or sign in with Google." Update after `/signup` ships.

---

### Task 4: `api_keys` table + management UI

**4.1 — MCP endpoint uses TWO secrets with different roles; plan treats them as one** 🔴
`app/api/mcp/route.ts` uses `MCP_SECRET` to authenticate the external MCP caller AND `RINGMARK_API_KEY` for the internal proxy to the REST API. Under multi-user, a fixed `MCP_SECRET` means all MCP callers share one account. **Fix**: eliminate `MCP_SECRET`. Make the HTTP MCP endpoint accept the same account-scoped API key in `Authorization: Bearer`. The proxy forwards this key to the REST API. One key, one account, one auth layer. Update claude.ai integration docs accordingly.

**4.2 — DB hash lookup is not timing-safe the way the current implementation is** 🟡
The current `verifyApiKey()` uses `timingSafeEqual`. The new DB-lookup approach introduces a timing oracle at the network level (index hit vs. miss). Accept as a known risk (network jitter dominates), document in a comment, or do a `timingSafeEqual` of the returned `key_hash` against the computed hash in application code after the query.

**4.3 — 8-char `key_prefix` may not uniquely identify keys over a long lifetime** 🟢
Make `label` required in the creation UI (not the DB schema). Prompt: "What's this key for?" with examples: "claude.ai MCP", "local dev".

**4.4 — "Show key once" needs a client component — plan doesn't specify** 🟡
The settings page is currently a server component. A raw key must never touch a URL (logged everywhere: Vercel, browsers, Nginx). Implement as a `CreateKeyButton` client component that calls a `createApiKey()` server action, receives the raw key, and renders it in an inline copy widget. Clear from state after N seconds.

---

### Task 5: Swap `verifyApiKey()` + `getAccount()`

**5.1 — `getAccount()` throws on miss; all 6 API route call sites are uncaught** 🔴
`lib/supabase/service.ts` throws `new Error('No account found')` if the key isn't found. All 6 API route files call it without try/catch — an invalid key produces a 500, not a 401. **Fix**: merge `verifyApiKey()` and `getAccount()` into a single `authenticateApiRequest(request)` that returns `{ account, error }`. Callers check the error and return 401. Eliminates the two-step call pattern across all routes.

**5.2 — No atomic cutover from env var to DB — deployment window breaks MCP** 🔴
There is no zero-downtime swap. The moment `verifyApiKey()` switches to DB lookups and the existing key hasn't been seeded, all API and MCP calls fail. **Fix**: dual-mode `verifyApiKey()`:
1. Try DB lookup first.
2. If no match, fall back to `RINGMARK_API_KEY` env var.
3. Seed the existing key into `api_keys` in a migration or startup check.
4. After confirming DB key works in production, remove the env var and fallback in a separate deploy.
Two deploys minimum — never remove the env var and the fallback in the same deployment.

**5.3 — `mcp/index.ts` (stdio) reads `RINGMARK_API_KEY` from `.env.local`** 🟡
Local dev using Claude Desktop will silently break when the env var key stops working. Document the migration path: "Generate a new API key from Settings → API Keys, copy it to `.env.local` as `RINGMARK_API_KEY`."

**5.4 — `deleteTestData()` in E2E helpers uses `owner_user_id`** 🟡
`e2e/helpers/supabase-admin.ts` looks up accounts by `owner_user_id`. Any future test that sets up a user as an *invited member* (not account owner) would leave orphaned accounts on teardown. Change to look up via `account_members WHERE user_id = userId`.

---

### Task 6: Cross-account isolation test suite

**6.1 — 4 REST endpoints missing from the 8-case test matrix** 🟡
Add to `e2e/security-cross-account.spec.ts`:
- `PATCH /api/v1/objects/{a-uuid}` with B's key → 404
- `GET /api/v1/objects/{a-uuid}/lineage` with B's key → 404
- `PATCH /api/v1/objects/{a-uuid}/photos/{photo-uuid}` with B's key → 404
- `GET /api/v1/objects/{a-uuid}/photos` with B's key → 404

**6.2 — Test fixtures need account IDs but `global-setup.ts` doesn't expose them** 🟡
`createApiKey(accountId)` requires an `accountId`, but global setup only saves browser auth state — no account IDs. Add to `e2e/helpers/supabase-admin.ts`:

```ts
export async function getAccountIdForUser(userId: string): Promise<string> {
  const { data } = await adminClient()
    .from('account_members')
    .select('account_id')
    .eq('user_id', userId)
    .limit(1)
    .single()
  if (!data) throw new Error(`No account for user ${userId}`)
  return data.account_id
}
```

**6.3 — `auth.spec.ts` creates a real object with no cleanup** 🟢
`e2e/auth.spec.ts` `beforeAll` creates an object in user A's account via the admin UI and never deletes it. Same accumulation problem as the 26 APITST objects, just slower. Add an `afterAll` that deletes the object via the REST API.

---

### Cross-cutting findings

**X.1 — Two sources of truth for "is this user an owner"** 🟡
`accounts.owner_user_id` (NOT NULL) and `account_members.role` will both exist after Phase 1. The plan doesn't address updating the "accounts: owner can update/delete" RLS policies. As part of task 2, update these policies to check `role = 'owner'` via `account_members` — making `owner_user_id` a historical artifact only.

**X.2 — No transition plan for the Vercel env var** 🟡
Three-deploy sequence:
1. Deploy `api_keys` migration (table exists, old auth unchanged).
2. Run seeding script to insert hashed `RINGMARK_API_KEY` into `api_keys`.
3. Deploy updated `verifyApiKey()` with dual-mode fallback.
4. Confirm working, then remove env var and fallback in a fourth deploy.

---

---

## Phase 1 final verification (review 3)

> Third-pass verification: every finding from review 2 checked line-by-line against the actual code. Confirmed, corrected, and new findings below.

### Verified status of all prior findings

All 🔴 and 🟡 findings from review 2 are **CONFIRMED** against the code, with the following corrections and additions:

- **3.1** — correctly marked false. `/auth/callback` exists and is properly implemented.
- **3.4 NEW** 🟢 — invite UI at `/invite/[token]/page.tsx` already exists and works (anonymous → login → claim flow complete). Remove "invite flow UI" from Phase 3 scope — it's done.
- **NEW-C** 🟢 — `create_account_for_user()` handles new Google OAuth users correctly (idempotent, race-safe via `ON CONFLICT DO NOTHING`). No action needed.

### New findings from review 3

**NEW 2.2a — `create_account_for_user()` doesn't set `role = 'owner'`** 🔴
`20260622000001` line 53: `insert into account_members (account_id, user_id) values (v_account_id, v_user_id) on conflict (account_id, user_id) do nothing` — no `role` column. With `DEFAULT 'member'`, every new account's creator gets `role = 'member'`, locking them out of billing and invite management from day one. Must be fixed in the same migration that adds the `role` column.

**NEW 5.1a — `getAccount()` returns the oldest account regardless of which API key was used** 🔴
`lib/supabase/service.ts` lines 27–33: `.order('created_at', { ascending: true }).limit(1)` — returns the first account ever created. Under multi-user, account B's API key would be verified and then `getAccount()` would return account A's data. Critical correctness bug. The `authenticateApiRequest()` merge must return the account the key belongs to, not the oldest account.

**NEW-A — `/maker` page and `sitemap.ts` have hardcoded first-account queries** 🔴 *(Phase 3 blocker, not Phase 1)*
`app/maker/page.tsx` queries `accounts` with `.order('created_at', ascending: true).limit(1)` — returns the oldest account's profile for all visitors. Same in `app/maker/opengraph-image.tsx` and `app/sitemap.ts`. Not a Phase 1 blocker, but must be addressed before open multi-user launch. Each account needs a unique maker URL (`/maker/[handle]` or similar). Add to Phase 3 scope.

**NEW-D — `account_invites` RLS policy also has no role check** 🟡
`20260617000001` line 43: `"account_invites: members can insert"` allows any member to create invites at the DB layer, not just via the server action. A member calling the RPC directly bypasses the server action check. Fix both the RLS policy and `createInvite()` in the same migration step.

**NEW-E — `deleteTestData()` + role migration breaks test setup** 🟡
After the role migration, `create_account_for_user()` will set `role = 'member'` (until 2.2a is fixed) — meaning every test run that calls `global-teardown.ts` + `global-setup.ts` recreates the test account with the owner as a member. Must fix 2.2a before any test runs against a migrated DB.

**NEW-B — `settings/page.tsx` uses service role to list members; filter is load-bearing** 🟢
`app/(admin)/settings/page.tsx` uses `createAdminClient()` (service role) to query members and resolve emails. The `.eq('account_id', account.id)` filter is the only thing preventing exposure of all accounts' members. Add a comment marking this filter as load-bearing.

**NEW 1.4 — Anon storage policy has no path scoping** 🟡
`20260616000002_storage_anon_signed_urls.sql`: `"object_photos: anon signed url read"` with `using (bucket_id = 'object-photos')` — no path restriction. Any anonymous caller can generate a signed URL for any path in the bucket if they can guess the structure (`uuid/uuid/uuid.ext`). Not practically exploitable but worth documenting as a known architectural limitation.

---

### Final clean findings table

**🔴 Blocking**

| # | Finding | Where |
|---|---|---|
| 1.2 | Storage policies must be DROPped before new ones are created | migration |
| 2.1 | Backfill must only promote `owner_user_id` rows, not all members | migration |
| 2.2a *(new)* | `create_account_for_user()` must set `role = 'owner'` explicitly | `20260622000001` → new migration |
| 4.1 | `MCP_SECRET` and `RINGMARK_API_KEY` both need replacing with account-scoped key | `app/api/mcp/route.ts` |
| 5.1 | `getAccount()` throws on miss; all 6 API routes have no try/catch → 500 not 401 | all `app/api/v1/` routes |
| 5.1a *(new)* | `getAccount()` returns oldest account regardless of API key — wrong account served | `lib/supabase/service.ts:27–33` |
| 5.2 | No atomic cutover; dual-mode fallback required across two deploys | `lib/api-auth.ts` |

**🟡 Important**

| # | Finding | Where |
|---|---|---|
| 1.3 | No automated test for storage RLS fix | `e2e/` |
| 1.4 *(new)* | Anon storage policy has no path scoping — document as known limitation | `20260616000002` |
| 2.2 | `claim_account_invite()` should explicitly set `role = 'member'` | migration |
| 2.3 | `createInvite()` server action has no role check | `actions/members.ts` |
| 2.4 | `saveProfile()` silently fails for non-owner members | `actions/profile.ts` |
| 2.5 | `getOrCreateAccount()` uses `.single()` — spurious account creation on edge cases | `lib/supabase/account.ts:19` |
| NEW-D | `account_invites: members can insert` RLS also has no role check | migration |
| NEW-E | Test teardown + role migration = recreated test users get `role = 'member'` | fix 2.2a first |
| 3.2 | `/signup` form should show generic message for existing email | step 4 |
| 4.2 | DB hash lookup timing oracle — document and accept | new `lib/api-auth.ts` |
| 4.4 | "Show key once" requires client component — raw key must never touch a URL | step 6 UI |
| 5.3 | `mcp/index.ts` reads `RINGMARK_API_KEY`; local MCP breaks silently after swap | docs |
| 5.4 | `deleteTestData()` uses `owner_user_id` — change to `account_members` join | `e2e/helpers/supabase-admin.ts:83` |
| 6.1 | 4 REST endpoints missing from cross-account test matrix | `e2e/security-cross-account.spec.ts` |
| 6.2 | Test fixtures need `getAccountIdForUser()` helper | `e2e/helpers/supabase-admin.ts` |
| X.1 | "accounts: owner can update/delete" RLS still uses `owner_user_id` | migration |
| X.2 | Four-deploy sequence for Vercel env var transition | deployment runbook |

**🟢 Tech debt / nice to have**

| # | Finding | Where |
|---|---|---|
| NEW-A | `/maker` + `sitemap.ts` hardcoded first-account query — Phase 3 blocker | `app/maker/`, `app/sitemap.ts` |
| NEW-B | `settings/page.tsx` service role filter is load-bearing — add comment | `app/(admin)/settings/page.tsx` |
| 3.3 | Settings page copy — update when `/signup` ships | `app/(admin)/settings/page.tsx:106` |
| 3.4 | Invite UI already exists at `/invite/[token]` — remove from Phase 3 scope | plan only |
| 4.3 | Require label in API key creation UI | step 6 |
| 6.3 | `auth.spec.ts` `beforeAll` creates object with no `afterAll` cleanup | `e2e/auth.spec.ts` |
| NEW-F | `wood_objects: anon read` — canary tests are the only defence | keep tests |

---

### Revised sequencing (final)

> **Scope decision 2026-06-29**: Phase 1 is single-user-per-account. The architecture (account_members, role column) is built to support multiple users per account later, but nothing that uses roles is surfaced yet. Invite management, member-gating, and `saveProfile()` multi-user edge cases are deferred to a future iteration.

**What's deferred:**
- Gating `createInvite()` to owners (finding 2.3 / NEW-D)
- Fixing `saveProfile()` silent failure for members (finding 2.4 — no non-owner members yet)
- Updating `account_invites` RLS to require owner role (NEW-D)
- Updating `claim_account_invite()` to set `role = 'member'` explicitly (finding 2.2)
- `getOrCreateAccount()` `.single()` → `.maybeSingle()` edge case (finding 2.5)
- Invite UI (already built at `/invite/[token]` — remains dormant)

**Steps:**

1. Fix storage RLS — drop old `owner_user_id`-based policies on `storage.objects`, add membership join (copy `avatars` bucket pattern). Drop before create. → deploy
2. Add `role text NOT NULL DEFAULT 'member'` to `account_members`; precise backfill (only `owner_user_id` rows → `'owner'`); update `create_account_for_user()` to set `role = 'owner'` explicitly; update "accounts: owner can update/delete" RLS to check `role = 'owner'` via `account_members` instead of `owner_user_id`. → deploy
3. Add `/signup` route (Google OAuth + password; `/auth/callback` already exists and works) → deploy
4. Add `api_keys` table migration → deploy; **then run seeding script to hash and insert existing `RINGMARK_API_KEY`**
5. Build API keys management UI (`CreateKeyButton` client component, label required, owner-only page)
6. Merge `verifyApiKey()` + `getAccount()` into single `authenticateApiRequest(request)` returning `{ account, error }` — account derived from key's `account_id`, not oldest account; dual-mode fallback (DB first, env var second) → deploy; confirm working → remove fallback + env var → deploy
7. Update MCP HTTP endpoint: accept account-scoped API key in `Authorization: Bearer`, eliminate `MCP_SECRET`, forward key to internal REST proxy → deploy
8. Cross-account isolation test suite: `getAccountIdForUser()` helper, `createApiKey()` fixture, `e2e/security-cross-account.spec.ts` (12 cases), fix `deleteTestData()` to use `account_members` join, fix `auth.spec.ts` missing `afterAll` (can run in parallel with steps 4–7)

*(Phase 3 — before open multi-user launch):* Fix `/maker` page and `sitemap.ts` account scoping; surface invite management UI with role-gating.

The original 1→2→3→4→5→6 order has two bugs: tasks 2 and 3 don't mention fixing `accounts` RLS or gating `createInvite()`, and the env var cutover needs an explicit checkpoint between the migration and the code swap.

**Revised order:**

1. Fix storage RLS (drop old policies, add membership-based ones) → deploy
2. Add `role` to `account_members` with precise backfill; update `claim_account_invite()`; update `accounts` owner RLS policies to use `role = 'owner'` → deploy
3. Gate `createInvite()` and settings UI to `role = 'owner'`; fix `saveProfile()` silent failure → deploy
4. Add `/signup` route (Google OAuth + password; `/auth/callback` already exists and works) → deploy
5. Add `api_keys` table migration → deploy; **then run seeding script for existing key**
6. Build API keys management UI (owner-only, `CreateKeyButton` client component, label required)
7. Swap `verifyApiKey()` + `getAccount()` into unified `authenticateApiRequest()` with dual-mode fallback → deploy; confirm working → remove fallback → deploy
8. Update MCP HTTP endpoint to use account-scoped API key instead of `MCP_SECRET`
9. Write cross-account isolation test suite (can run in parallel with steps 5–8)
