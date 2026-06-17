-- ============================================================
-- account_members: ties auth users to accounts
-- All member insertions go through SECURITY DEFINER functions —
-- no direct INSERT RLS so arbitrary users can't add themselves.
-- ============================================================

create table account_members (
  account_id  uuid not null references accounts(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (account_id, user_id)
);

alter table account_members enable row level security;

-- Members can read their own membership row (lets getOrCreateAccount resolve account_id)
create policy "account_members: read own membership"
  on account_members for select
  to authenticated
  using (user_id = auth.uid());

-- Backfill: existing account owners become the first member of their account
insert into account_members (account_id, user_id)
select id, owner_user_id from accounts;


-- ============================================================
-- account_invites: one-time invite tokens (7-day expiry)
-- ============================================================

create table account_invites (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  created_by  uuid not null references auth.users(id),
  expires_at  timestamptz not null default now() + interval '7 days',
  claimed_at  timestamptz,
  claimed_by  uuid references auth.users(id)
);

alter table account_invites enable row level security;

-- Members can create invites for their account
create policy "account_invites: members can insert"
  on account_invites for insert
  to authenticated
  with check (
    account_id in (select account_id from account_members where user_id = auth.uid())
    and created_by = auth.uid()
  );

-- Members can view their account's invites
create policy "account_invites: members can read"
  on account_invites for select
  to authenticated
  using (
    account_id in (select account_id from account_members where user_id = auth.uid())
  );


-- ============================================================
-- Function: create_account_for_user()
-- Creates a new account and adds the caller as the first member atomically.
-- Called by getOrCreateAccount() when no membership exists.
-- SECURITY DEFINER so it can bypass the no-INSERT policy on account_members.
-- ============================================================

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

  -- Guard: if already a member, return existing account
  select account_id into v_account_id
  from account_members
  where user_id = v_user_id
  limit 1;

  if v_account_id is not null then
    return v_account_id;
  end if;

  insert into accounts (owner_user_id) values (v_user_id) returning id into v_account_id;
  insert into account_members (account_id, user_id) values (v_account_id, v_user_id);

  return v_account_id;
end;
$$;


-- ============================================================
-- Function: claim_account_invite(invite_id uuid)
-- Validates the token, adds the caller to account_members, marks invite claimed.
-- SECURITY DEFINER so the non-member caller can insert into account_members.
-- Returns a jsonb result so the caller can distinguish error cases.
-- ============================================================

create or replace function claim_account_invite(invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite account_invites;
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select * into v_invite from account_invites where id = invite_id for update;

  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if v_invite.claimed_at is not null then
    -- Already claimed — if it was claimed by this user, treat as success
    if v_invite.claimed_by = v_user_id then
      return jsonb_build_object('success', true, 'account_id', v_invite.account_id);
    end if;
    return jsonb_build_object('error', 'already_claimed');
  end if;

  if v_invite.expires_at < now() then
    return jsonb_build_object('error', 'expired');
  end if;

  -- Already a member of this account — idempotent success
  if exists (
    select 1 from account_members
    where account_id = v_invite.account_id and user_id = v_user_id
  ) then
    return jsonb_build_object('success', true, 'account_id', v_invite.account_id);
  end if;

  insert into account_members (account_id, user_id) values (v_invite.account_id, v_user_id);
  update account_invites set claimed_at = now(), claimed_by = v_user_id where id = invite_id;

  return jsonb_build_object('success', true, 'account_id', v_invite.account_id);
end;
$$;


-- ============================================================
-- Update RLS: swap owner_user_id checks for membership checks
-- on wood_objects and object_photos so account members have access.
-- ============================================================

drop policy "wood_objects: owner full access" on wood_objects;
create policy "wood_objects: members full access"
  on wood_objects for all
  to authenticated
  using (
    account_id in (select account_id from account_members where user_id = auth.uid())
  )
  with check (
    account_id in (select account_id from account_members where user_id = auth.uid())
  );

drop policy "object_photos: owner full access" on object_photos;
create policy "object_photos: members full access"
  on object_photos for all
  to authenticated
  using (
    account_id in (select account_id from account_members where user_id = auth.uid())
  )
  with check (
    account_id in (select account_id from account_members where user_id = auth.uid())
  );

-- Update accounts policy: members can read (for account name in header),
-- only owner can modify.
drop policy "accounts: owner full access" on accounts;

create policy "accounts: members can read"
  on accounts for select
  to authenticated
  using (
    id in (select account_id from account_members where user_id = auth.uid())
  );

create policy "accounts: owner can insert"
  on accounts for insert
  to authenticated
  with check (owner_user_id = auth.uid());

create policy "accounts: owner can update"
  on accounts for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "accounts: owner can delete"
  on accounts for delete
  to authenticated
  using (owner_user_id = auth.uid());
