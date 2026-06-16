-- Allow anonymous users to read ANY wood_object row (for slug routing).
-- Without this, the public page can't distinguish "not found" from "not published yet"
-- because the old policy blocked anon reads of unpublished rows entirely.
--
-- Privacy is enforced at the application layer: public queries NEVER SELECT
-- private_notes, location_text, or workshop_id. RLS is the second layer.

drop policy if exists "wood_objects: anon read published" on wood_objects;

create policy "wood_objects: anon read"
  on wood_objects
  for select
  to anon
  using (true);
