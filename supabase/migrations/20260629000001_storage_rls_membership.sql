-- Replace owner_user_id-based storage policies on object-photos with
-- account_members-based policies, consistent with the avatars bucket
-- pattern introduced in 20260617000002.
--
-- The anon signed-url read policy is intentionally left unchanged —
-- it is required for /p/[slug] public pages and has no path scoping
-- (accepted known limitation; privacy is enforced at the app layer).

drop policy "object_photos: owner upload" on storage.objects;
drop policy "object_photos: owner read"   on storage.objects;
drop policy "object_photos: owner delete" on storage.objects;

create policy "object_photos: members upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'object-photos'
    and (storage.foldername(name))[1] in (
      select a.id::text from accounts a
      join account_members am on am.account_id = a.id
      where am.user_id = auth.uid()
    )
  );

create policy "object_photos: members read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'object-photos'
    and (storage.foldername(name))[1] in (
      select a.id::text from accounts a
      join account_members am on am.account_id = a.id
      where am.user_id = auth.uid()
    )
  );

create policy "object_photos: members delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'object-photos'
    and (storage.foldername(name))[1] in (
      select a.id::text from accounts a
      join account_members am on am.account_id = a.id
      where am.user_id = auth.uid()
    )
  );
