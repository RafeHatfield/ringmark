-- Add profile fields to accounts
alter table accounts
  add column if not exists display_name text,
  add column if not exists workshop_name text,
  add column if not exists bio           text,
  add column if not exists avatar_storage_path text;

-- Public avatars storage bucket (one image per account, path = account_id)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Account members can upload/update/delete their account's avatar
create policy "account members can manage avatar"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'avatars' and
    name in (
      select a.id::text from accounts a
      join account_members am on am.account_id = a.id
      where am.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'avatars' and
    name in (
      select a.id::text from accounts a
      join account_members am on am.account_id = a.id
      where am.user_id = auth.uid()
    )
  );

-- Public can read avatars
create policy "public can view avatars"
  on storage.objects for select to public
  using (bucket_id = 'avatars');
