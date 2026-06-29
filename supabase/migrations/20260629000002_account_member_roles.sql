-- Add role column to account_members and update auth-related policies
-- to use role-based checks instead of owner_user_id.
--
-- Scope: single-user-per-account phase. The column and backfill lay the
-- foundation for future multi-user support without surfacing any member
-- management UI yet. claim_account_invite(), createInvite() gating, and
-- saveProfile() member edge cases are deferred to the multi-user iteration.

-- ── 1. Add role column ────────────────────────────────────────────────────────

alter table account_members
  add column role text not null default 'member'
    check (role in ('owner', 'member'));

-- ── 2. Backfill: promote only the account creator row to 'owner' ──────────────
--
-- Rows where user_id = accounts.owner_user_id are the original account
-- creators. All other members (future invited members) keep 'member'.

update account_members am
set role = 'owner'
from accounts a
where am.account_id = a.id
  and am.user_id = a.owner_user_id;

-- ── 3. Update create_account_for_user() to set role = 'owner' ─────────────────
--
-- Without this, new accounts created after this migration would have
-- their creator inserted with role = 'member' (the column default),
-- locking them out of owner-gated features when those are added.

create or replace function create_account_for_user()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_user_id    uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Fast path: already a member
  select account_id into v_account_id
  from account_members
  where user_id = v_user_id
  limit 1;

  if v_account_id is not null then
    return v_account_id;
  end if;

  -- Upsert account — ON CONFLICT handles concurrent first-login race
  insert into accounts (owner_user_id)
  values (v_user_id)
  on conflict (owner_user_id) do nothing
  returning id into v_account_id;

  -- If INSERT was a no-op (concurrent call already created the account),
  -- fetch the existing row
  if v_account_id is null then
    select id into v_account_id
    from accounts
    where owner_user_id = v_user_id;
  end if;

  -- Add membership with owner role — ON CONFLICT is idempotent
  insert into account_members (account_id, user_id, role)
  values (v_account_id, v_user_id, 'owner')
  on conflict (account_id, user_id) do nothing;

  return v_account_id;
end;
$$;

-- ── 4. Update accounts RLS: check role = 'owner' instead of owner_user_id ─────
--
-- "accounts: owner can insert" is intentionally left as-is: account
-- creation goes through the SECURITY DEFINER function which bypasses RLS,
-- making this policy effectively a safety net only.

drop policy "accounts: owner can update" on accounts;
create policy "accounts: owner can update"
  on accounts for update
  to authenticated
  using (
    id in (
      select account_id from account_members
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    id in (
      select account_id from account_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

drop policy "accounts: owner can delete" on accounts;
create policy "accounts: owner can delete"
  on accounts for delete
  to authenticated
  using (
    id in (
      select account_id from account_members
      where user_id = auth.uid() and role = 'owner'
    )
  );
