-- Fix concurrent first-login race in create_account_for_user().
--
-- Root cause: when two server components (layout + page) both call
-- getOrCreateAccount() concurrently for a brand-new user, both read
-- account_members (empty), both attempt INSERT into accounts, and the
-- second throws "duplicate key value violates unique constraint
-- accounts_owner_user_id_idx".
--
-- Fix: INSERT … ON CONFLICT DO NOTHING + fallback SELECT on both tables,
-- making the function fully idempotent under concurrent calls.

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

  -- If INSERT was a no-op (a concurrent call already created the account),
  -- fetch the existing row
  if v_account_id is null then
    select id into v_account_id
    from accounts
    where owner_user_id = v_user_id;
  end if;

  -- Add membership — primary key (account_id, user_id) makes this idempotent too
  insert into account_members (account_id, user_id)
  values (v_account_id, v_user_id)
  on conflict (account_id, user_id) do nothing;

  return v_account_id;
end;
$$;
