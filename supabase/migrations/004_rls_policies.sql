-- ============================================================
-- accounts: owner-only access
-- ============================================================

create policy "accounts: owner full access"
  on accounts
  for all
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());


-- ============================================================
-- wood_objects: owner full access + anon read of published rows
-- ============================================================

create policy "wood_objects: owner full access"
  on wood_objects
  for all
  to authenticated
  using (
    account_id in (
      select id from accounts where owner_user_id = auth.uid()
    )
  )
  with check (
    account_id in (
      select id from accounts where owner_user_id = auth.uid()
    )
  );

-- Anonymous users may SELECT published objects.
-- Column-level privacy is enforced in application queries — public queries
-- NEVER select private_notes, location_text, or workshop_id.
create policy "wood_objects: anon read published"
  on wood_objects
  for select
  to anon
  using (is_published = true);


-- ============================================================
-- object_photos: owner full access + anon read of public photos
-- ============================================================

create policy "object_photos: owner full access"
  on object_photos
  for all
  to authenticated
  using (
    account_id in (
      select id from accounts where owner_user_id = auth.uid()
    )
  )
  with check (
    account_id in (
      select id from accounts where owner_user_id = auth.uid()
    )
  );

-- Anonymous users may SELECT public photos on published objects only.
create policy "object_photos: anon read public photos of published objects"
  on object_photos
  for select
  to anon
  using (
    is_public = true
    and exists (
      select 1 from wood_objects
      where wood_objects.id = object_photos.object_id
      and wood_objects.is_published = true
    )
  );
