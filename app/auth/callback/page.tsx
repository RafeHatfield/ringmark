'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

function Spinner() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Signing in…</p>
    </main>
  )
}

function CallbackHandler() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const supabase = createClient()
    const code = searchParams.get('code')
    const token_hash = searchParams.get('token_hash')
    const type = searchParams.get('type') as EmailOtpType | null

    async function handleCallback() {
      // PKCE flow — browser client has the verifier it stored at sign-in time
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) { success(); return }
      }

      // Token-hash flow — Supabase sends token_hash + type instead of code
      if (token_hash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash, type })
        if (!error) { success(); return }
      }

      // Implicit flow — tokens may already be parsed from the URL hash by the client
      const { data: { session } } = await supabase.auth.getSession()
      if (session) { success(); return }

      router.replace('/auth?error=Sign-in+link+expired+or+invalid')
    }

    function success() {
      router.replace('/')
      router.refresh()
    }

    handleCallback()
  }, [router, searchParams])

  return <Spinner />
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CallbackHandler />
    </Suspense>
  )
}
