-- Allow the anon role to generate signed URLs for the object-photos bucket.
-- Required for /p/[slug] server component which uses the anon Supabase client
-- to call createSignedUrls. Without this, signed URL generation returns null
-- and no photos render on the public page.
-- Privacy is enforced at the app layer: only photos with is_public=true are
-- fetched before this call is ever made.

create policy "object_photos: anon signed url read"
  on storage.objects for select
  to anon
  using (bucket_id = 'object-photos');
