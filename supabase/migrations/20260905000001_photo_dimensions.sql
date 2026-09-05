-- ============================================================
-- object_photos: pixel dimensions
--
-- Recorded at upload time by both upload paths (the multipart POST and the
-- signed direct PUT), parsed from the image's header bytes in
-- lib/photo-upload.ts. No image library involved — width and height sit in the
-- first few dozen bytes of JPEG, PNG and WebP, so a native dependency in the
-- serverless bundle would buy nothing.
--
-- Nullable on purpose, and left null for existing rows rather than backfilled.
-- A backfill would mean downloading every stored image to measure it, and
-- nothing renders differently for want of a dimension. HEIC is also always
-- null: its size lives in a nested ISO-BMFF `ispe` box, which needs a real
-- parser rather than a header read.
--
-- Consumers must treat null as "unknown", never as zero.
-- ============================================================

alter table object_photos
  add column width integer,
  add column height integer;

comment on column object_photos.width is
  'Pixel width, parsed at upload. Null when unknown (pre-existing row, or HEIC).';
comment on column object_photos.height is
  'Pixel height, parsed at upload. Null when unknown (pre-existing row, or HEIC).';
