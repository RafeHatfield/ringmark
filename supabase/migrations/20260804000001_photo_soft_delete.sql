-- ============================================================
-- object_photos: soft delete
--
-- Photo deletion becomes reversible. The remote MCP server is on the
-- public internet, so an irreversible delete tool there is a hazard —
-- soft delete keeps the utility without the one-way door.
--
-- Storage files are RETAINED on soft delete. The object-photos bucket is
-- private and every public read mints a signed URL on demand from
-- storage_path (see 20260616000002_storage_anon_signed_urls.sql), so
-- filtering soft-deleted rows out of the read paths is sufficient to make
-- the file unreachable: no signed URL is ever generated for it.
--
-- Purging storage for photos deleted beyond a retention window is a
-- separate follow-up, not handled here.
--
-- Hard delete still exists for whole objects (DELETE /api/v1/objects/:id),
-- which removes photo storage files outright.
-- ============================================================

alter table object_photos
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id);

-- ── Index ─────────────────────────────────────────────────────────────────────
--
-- Every hot read path filters `deleted_at is null`, so make the index partial.
-- Soft-deleted rows are only read by the restore path, which goes by id (PK).

drop index if exists object_photos_object_id_idx;

create index object_photos_object_id_idx
  on object_photos (object_id, sort_order)
  where deleted_at is null;

-- Supports the "list deleted photos for this object" path used by restore.
create index object_photos_deleted_idx
  on object_photos (object_id, deleted_at)
  where deleted_at is not null;

-- ── RLS ───────────────────────────────────────────────────────────────────────
--
-- Anon must never see a soft-deleted photo. This is the second layer; the
-- application layer already filters (public page + OG card), but a deleted
-- photo reappearing on a public story page is exactly the failure this
-- guards against.
--
-- The authenticated "members full access" policy (20260617000001) is left
-- alone on purpose — members need to read soft-deleted rows to restore them.

drop policy "object_photos: anon read public photos of published objects" on object_photos;

create policy "object_photos: anon read public photos of published objects"
  on object_photos
  for select
  to anon
  using (
    is_public = true
    and deleted_at is null
    and exists (
      select 1 from wood_objects
      where wood_objects.id = object_photos.object_id
      and wood_objects.is_published = true
    )
  );
