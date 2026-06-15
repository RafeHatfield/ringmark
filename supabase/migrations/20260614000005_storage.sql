-- Create private bucket for object photos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'object-photos',
  'object-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- Storage RLS policies
-- Path structure: {account_id}/{object_id}/{filename}
-- The first folder component must match the authenticated user's account id.

create policy "object_photos: owner upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'object-photos'
    and (storage.foldername(name))[1] in (
      select id::text from accounts where owner_user_id = auth.uid()
    )
  );

create policy "object_photos: owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'object-photos'
    and (storage.foldername(name))[1] in (
      select id::text from accounts where owner_user_id = auth.uid()
    )
  );

create policy "object_photos: owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'object-photos'
    and (storage.foldername(name))[1] in (
      select id::text from accounts where owner_user_id = auth.uid()
    )
  );
