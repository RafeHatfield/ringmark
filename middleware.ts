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

  const isAdminRoute =
    pathname === '/workshop' ||
    pathname.startsWith('/objects') ||
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

  if (isAuthRoute && user) {
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
    // api/mcp and .well-known are excluded on purpose: both are token-authenticated
    // or fully public, they must answer identically to anonymous clients, and
    // running the Supabase session refresh on them only adds latency and cookie
    // churn to requests that will never carry a browser session.
    '/((?!_next/static|_next/image|favicon.ico|api/mcp|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
