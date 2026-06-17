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
    pathname.startsWith('/settings')
  const isAuthRoute = pathname === '/login'

  if (isAdminRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
