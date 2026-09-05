-- ============================================================
-- object_photos: pending uploads (signed direct upload)
--
-- The hosted MCP server can't read the caller's disk, and base64 through the
-- model's context tops out around 100 KB. This adds a two-step flow: an
-- authenticated MCP call reserves a photo row and mints a single-use token,
-- then the bytes are PUT straight to /api/upload with that token. The image
-- never passes through the model's context.
--
-- A reserved-but-not-yet-uploaded row is status='pending'. It has a
-- storage_path (derived server-side at reservation time, so the NOT NULL
-- invariant holds and the sweep always knows what to clean up) but no file
-- behind it yet.
--
-- Existing rows default to 'live', so nothing changes for current data.
-- ============================================================

alter table object_photos
  add column status text not null default 'live'
    check (status in ('pending', 'live')),
  add column upload_token_hash text,
  add column upload_expires_at timestamptz,
  add column upload_consumed_at timestamptz,
  add column bytes integer;

comment on column object_photos.upload_token_hash is
  'SHA-256 hex of the single-use upload token. The plaintext is returned once and never stored. Nulled on consumption.';

-- ── Indexes ───────────────────────────────────────────────────────────────────
--
-- The token lookup is the hot path on /api/upload and must not table-scan.
-- Partial, because only pending rows ever carry a hash.

create index object_photos_upload_token_hash_idx
  on object_photos (upload_token_hash)
  where upload_token_hash is not null;

-- Supports the hourly sweep of abandoned reservations.
create index object_photos_pending_idx
  on object_photos (upload_expires_at)
  where status = 'pending';

-- The hot read index already filters soft-deleted rows; add status so pending
-- rows are excluded at the index level too. Every read path that filters
-- `deleted_at is null` now also filters `status = 'live'`.
drop index if exists object_photos_object_id_idx;

create index object_photos_object_id_idx
  on object_photos (object_id, sort_order)
  where deleted_at is null and status = 'live';

-- ── RLS ───────────────────────────────────────────────────────────────────────
--
-- Second layer, same reasoning as the soft-delete migration: the application
-- filters pending rows out of every public read path, and this makes a leak
-- impossible even if one of those filters is forgotten. A pending row is a
-- reservation with no bytes behind it — it must never reach a public page.
--
-- The authenticated "members full access" policy is left alone: the admin UI
-- and the API need to see pending rows to report on them.

drop policy "object_photos: anon read public photos of published objects" on object_photos;

create policy "object_photos: anon read public photos of published objects"
  on object_photos
  for select
  to anon
  using (
    is_public = true
    and deleted_at is null
    and status = 'live'
    and exists (
      select 1 from wood_objects
      where wood_objects.id = object_photos.object_id
      and wood_objects.is_published = true
    )
  );
