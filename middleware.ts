import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  const { pathname } = request.nextUrl

  // Supabase OAuth sometimes ignores redirectTo and sends ?code= to the Site URL root.
  // Intercept it here and forward to /auth/callback so the exchange can happen.
  const code = request.nextUrl.searchParams.get('code')
  if (code && pathname !== '/auth/callback') {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/callback'
    url.search = `?code=${encodeURIComponent(code)}`
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value)
    })
    return response
  }

  // Every auth-gated route must be listed here. A route that is missing does
  // not fall back to being public — it crashes, because the page calls
  // getOrCreateAccount(), which throws when there is no session. /markets was
  // missing and returned a 500 to anonymous visitors instead of a login
  // redirect. If you add an admin route group, add it here in the same commit.
  const isAdminRoute =
    pathname === '/workshop' ||
    pathname.startsWith('/objects') ||
    pathname.startsWith('/markets') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/profile') ||
    pathname.startsWith('/oauth')
  const isAuthRoute = pathname === '/login'

  if (isAdminRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Carry the original destination through login. The OAuth consent screen
    // depends on this: its authorization_id lives in the query string, and
    // without it the consent request can't be resolved after signing in.
    const next = `${pathname}${request.nextUrl.search}`
    url.search = `?next=${encodeURIComponent(next)}`
    const response = NextResponse.redirect(url)
    // Copy refreshed session cookies so the auth page sees the correct state
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value)
    })
    return response
  }

  // The landing page is static; send a signed-in maker to the workshop here
  // rather than reading the session inside the page.
  if ((isAuthRoute || pathname === '/') && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/workshop'
    const response = NextResponse.redirect(url)
    // Copy refreshed session cookies so the destination page sees the session
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value)
    })
    return response
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // api/mcp, api/upload and .well-known are excluded on purpose: all are
    // token-authenticated or fully public, they must answer identically to
    // anonymous clients, and running the Supabase session refresh on them only
    // adds latency and cookie churn to requests that will never carry a browser
    // session. For api/upload that cost lands on a multi-megabyte request body.
    //
    // p/, maker, {handle}/maker, contact, robots.txt and sitemap.xml are the
    // public surface: cached or static, identical for every viewer, and never
    // the place a session is needed. Matching them would spend a middleware
    // invocation per QR scan for nothing. The landing page stays matched
    // because its signed-in redirect lives here.
    '/((?!_next/static|_next/image|favicon.ico|api/mcp|api/upload|\\.well-known|p/|maker|[^/]+/maker$|contact$|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
