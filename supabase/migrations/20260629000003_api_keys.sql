-- Per-account API keys table.
--
-- Replaces the single RINGMARK_API_KEY env var with account-scoped keys
-- stored as SHA-256 hashes. The raw key is shown once at creation and
-- never stored. key_prefix (first 8 chars) lets users identify keys in
-- the UI without re-exposing the secret.
--
-- Note: DB-level hash lookup introduces a timing oracle compared to the
-- current timingSafeEqual approach. Network jitter dominates at this
-- scale; documented as an accepted trade-off in lib/api-auth.ts.

create table api_keys (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  key_hash      text not null unique,
  key_prefix    text not null,
  label         text,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

alter table api_keys enable row level security;

-- Members can list keys for their account (needed for the management UI)
create policy "api_keys: members can read"
  on api_keys for select to authenticated
  using (
    account_id in (
      select account_id from account_members where user_id = auth.uid()
    )
  );

-- Only owners can create keys
create policy "api_keys: owners can create"
  on api_keys for insert to authenticated
  with check (
    account_id in (
      select account_id from account_members
      where user_id = auth.uid() and role = 'owner'
    )
    and created_by = auth.uid()
  );

-- Only owners can revoke (delete) keys
create policy "api_keys: owners can revoke"
  on api_keys for delete to authenticated
  using (
    account_id in (
      select account_id from account_members
      where user_id = auth.uid() and role = 'owner'
    )
  );
