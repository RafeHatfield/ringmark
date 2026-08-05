-- ============================================================
-- Custom Access Token Hook: bind OAuth tokens to this resource server
--
-- The MCP authorization spec requires access tokens to be audience-bound to
-- the resource server they're for (RFC 8707 resource indicators). The MCP
-- server must then verify its own URL appears in the token's `aud`, which is
-- what stops a token minted for some other service being replayed at ours.
--
-- Supabase Auth does not implement RFC 8707. Verified empirically on
-- 2026-08-05: a full authorization-code + PKCE flow sending `resource` on both
-- the authorization request and the token request returns a token with
-- `aud: "authenticated"` — Supabase's standard role audience. The `resource`
-- parameter is accepted and ignored, and the AS metadata document does not
-- advertise resource-indicator support.
--
-- This hook closes that gap by rewriting `aud` for OAuth-issued tokens only.
--
-- WHY THE client_id GUARD MATTERS
--
-- The hook fires on EVERY token issuance, including ordinary web-app sessions.
-- Those must keep `aud = 'authenticated'` — supabase-js and PostgREST expect
-- it, and rewriting it would break the whole site. Only tokens issued through
-- the OAuth server carry a `client_id` claim, so that is the discriminator.
--
-- `authenticated` is kept alongside the resource URL rather than replaced, so
-- anything downstream that checks for it still works. `aud` is permitted to be
-- an array (RFC 7519 §4.1.3).
-- ============================================================

create or replace function public.oauth_audience_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
begin
  claims := event -> 'claims';

  -- Web-app sessions have no client_id — leave them completely alone.
  if claims ? 'client_id' then
    claims := jsonb_set(
      claims,
      '{aud}',
      jsonb_build_array(
        -- Must match what the resource server advertises as its canonical
        -- identifier (lib/mcp-auth.ts → mcpResourceUrl) and what it accepts
        -- (lib/api-auth.ts → acceptableAudiences). Both environments are
        -- listed so a token works against prod and local dev alike.
        'https://ringmark.org/api/mcp',
        'https://ringmark.org',
        'http://localhost:3000/api/mcp',
        'http://localhost:3000',
        'authenticated'
      )
    );
    event := jsonb_set(event, '{claims}', claims);
  end if;

  return event;
end;
$$;

-- Only the auth server may run this.
grant  execute on function public.oauth_audience_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.oauth_audience_hook(jsonb) from authenticated, anon, public;

-- The hook also needs to be registered in the dashboard:
--   Authentication → Hooks → Customize Access Token (JWT) Claims
--   → Postgres function → public.oauth_audience_hook
-- Creating the function alone does nothing until it is wired up there.
