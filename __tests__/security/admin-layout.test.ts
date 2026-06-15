/**
 * Admin layout and middleware contract tests.
 *
 * These tests catch two classes of production bugs that don't show up
 * as TypeScript errors or lint warnings but cause visible user-facing failure:
 *
 *   1. REDIRECT LOOP ANTI-PATTERN
 *      If the admin layout catches errors from getOrCreateAccount() and redirects
 *      to /auth, and the middleware then sees a logged-in user and redirects back
 *      to /, the result is an infinite redirect loop — the browser renders a blank
 *      page and the user is stuck. The middleware already guarantees only
 *      authenticated users reach admin routes, so catching and redirecting to /auth
 *      inside the layout is wrong for any reason other than an auth failure.
 *
 *   2. MIDDLEWARE COOKIE FORWARDING
 *      @supabase/ssr's updateSession() refreshes the access token and puts the new
 *      tokens on supabaseResponse's cookies. If the middleware returns a different
 *      NextResponse (e.g. a redirect) WITHOUT copying those cookies, the session
 *      refresh is lost. The next server request won't have the refreshed token and
 *      auth breaks silently.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const layoutSrc = readFileSync(resolve('./app/(admin)/layout.tsx'), 'utf8')
const middlewareSrc = readFileSync(resolve('./middleware.ts'), 'utf8')
const middlewareHelperSrc = readFileSync(resolve('./lib/supabase/middleware.ts'), 'utf8')

// ---------------------------------------------------------------------------
// Admin layout — redirect-loop prevention
// ---------------------------------------------------------------------------

describe('admin layout — redirect-loop prevention', () => {
  it('layout does NOT redirect to /auth on error (middleware already guards auth)', () => {
    // Redirecting to /auth from within the layout is dangerous: the middleware
    // will see the logged-in user and redirect back to /, creating an infinite loop
    // that renders a blank page. If getOrCreateAccount() fails for a non-auth reason
    // (DB error, RLS policy, etc.), the error should propagate to error.tsx instead.
    const hasDangerousPattern =
      layoutSrc.includes("redirect('/auth')") || layoutSrc.includes('redirect("/auth")')
    assert.ok(
      !hasDangerousPattern,
      'admin layout must NOT call redirect("/auth") — this creates a redirect loop when ' +
        'middleware sends authenticated users back to /. Let errors propagate to error.tsx instead.',
    )
  })

  it('layout calls getOrCreateAccount() to identify the session account', () => {
    assert.ok(
      layoutSrc.includes('getOrCreateAccount()'),
      'admin layout must call getOrCreateAccount() to load the account for the session user',
    )
  })

  it('layout renders children (layout is not accidentally empty)', () => {
    assert.ok(
      layoutSrc.includes('{children}'),
      'admin layout must render {children} — omitting it produces a blank page for every admin route',
    )
  })

  it('layout is a server component (no "use client" directive)', () => {
    assert.ok(
      !layoutSrc.includes("'use client'") && !layoutSrc.includes('"use client"'),
      'admin layout must be a server component — it fetches session data server-side',
    )
  })
})

// ---------------------------------------------------------------------------
// Middleware — cookie forwarding on redirects
// ---------------------------------------------------------------------------

describe('middleware — session cookie forwarding', () => {
  it('middleware copies supabaseResponse cookies onto redirect responses', () => {
    // When the middleware returns a NextResponse.redirect() instead of supabaseResponse,
    // the refreshed session tokens that updateSession() put on supabaseResponse are lost.
    // We must copy them onto every non-supabaseResponse response we return.
    // This test checks that getAll/set cookie forwarding appears alongside redirect calls.
    const hasRedirect = middlewareSrc.includes('NextResponse.redirect')
    const hasCookieCopy =
      middlewareSrc.includes('.cookies.getAll()') && middlewareSrc.includes('.cookies.set(')

    if (hasRedirect) {
      assert.ok(
        hasCookieCopy,
        'middleware has redirect responses but does not copy supabaseResponse cookies onto them. ' +
          'Without this, refreshed session tokens are lost and the next request fails auth.',
      )
    }
  })

  it('middleware uses auth.getUser() (not getSession()) for the auth check', () => {
    // The middleware delegates to updateSession() in lib/supabase/middleware.ts, which
    // is where getUser() is called. Either file satisfies the security requirement.
    const usesGetUser =
      middlewareSrc.includes('getUser()') ||
      middlewareHelperSrc.includes('auth.getUser()') ||
      middlewareHelperSrc.includes('.getUser()')
    assert.ok(
      usesGetUser,
      'middleware (or its updateSession helper) must call getUser() — getSession() trusts the ' +
        'client cookie without re-validating with the Supabase server, which is a security vulnerability',
    )
  })

  it('middleware calls updateSession to handle token refresh', () => {
    assert.ok(
      middlewareSrc.includes('updateSession'),
      'middleware must call updateSession() from lib/supabase/middleware to keep sessions alive',
    )
  })

  it('middleware protects admin routes (/ and /objects/**)', () => {
    assert.ok(
      middlewareSrc.includes("pathname === '/'") || middlewareSrc.includes("pathname.startsWith('/objects')"),
      'middleware must protect admin routes — unauthenticated users must be redirected to /auth',
    )
  })
})
