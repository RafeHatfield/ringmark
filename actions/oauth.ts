'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Consent decisions for Supabase Auth's OAuth 2.1 server.
 *
 * Both actions run against the caller's own session — Supabase resolves the
 * authorization request to the signed-in user, so a user can only ever approve
 * or deny their own pending authorization. There is no account_id to derive
 * and nothing to scope by hand.
 *
 * Both end in a redirect back to the OAuth client, carrying either an
 * authorization code or an error. That redirect URL comes from Supabase, not
 * from client input.
 */

export async function approveAuthorization(authorizationId: string): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to approve access.' }

  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId)
  if (error || !data?.redirect_url) {
    return { error: error?.message ?? 'Could not approve this request.' }
  }

  redirect(data.redirect_url)
}

export async function denyAuthorization(authorizationId: string): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to deny access.' }

  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId)
  if (error || !data?.redirect_url) {
    return { error: error?.message ?? 'Could not deny this request.' }
  }

  redirect(data.redirect_url)
}
