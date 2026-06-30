-- Add a URL-safe handle to accounts so each maker has a permanent URL
-- at /{handle}/maker (and eventually /{handle} for a workshop showcase page).
--
-- Nullable — existing accounts don't have handles yet; they set one via Profile.
-- Unique — each handle is globally exclusive, like a username.
-- Check constraint enforces URL-safe format: lowercase letters, numbers, hyphens;
-- must start and end with alphanumeric; 2–50 characters.

alter table accounts
  add column handle text unique
    check (
      handle is null or (
        handle ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
        and length(handle) between 2 and 50
      )
    );
