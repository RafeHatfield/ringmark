'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [oauthError, setOauthError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    const { data } = await supabase.auth.signUp({ email, password })

    // If immediately signed in (email confirmation disabled in Supabase), go straight through
    if (data.session) {
      router.replace('/workshop')
      router.refresh()
      return
    }

    // All other outcomes — email already exists, confirmation email sent, etc. —
    // show the same generic message to prevent email enumeration.
    setSubmitted(true)
    setLoading(false)
  }

  async function handleGoogleSignIn() {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setOauthError(error.message)
  }

  if (submitted) {
    return (
      <div className="text-center space-y-3 py-4">
        <p className="text-sm font-medium text-ink">Check your inbox.</p>
        <p className="text-sm text-bark">
          If this is a new account, you&rsquo;ll receive a confirmation link shortly.
        </p>
        <Link href="/login" className="text-sm text-cedar hover:underline block mt-4">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        onClick={handleGoogleSignIn}
        className="w-full flex items-center justify-center gap-2 border border-hairline rounded-md px-4 py-2.5 text-sm font-medium hover:bg-sand transition-colors"
      >
        <GoogleIcon />
        Sign up with Google
      </button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-hairline" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-paper px-2 text-bark">or</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoFocus
            autoComplete="email"
            className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-hairline rounded-md px-3 py-2 text-sm bg-paper focus:outline-none focus:ring-1 focus:ring-cedar"
          />
        </div>
        {oauthError && (
          <p className="text-sm text-destructive">{oauthError}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-cedar text-paper rounded-md px-4 py-2.5 text-sm font-medium hover:bg-heartwood disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-xs text-center text-bark">
        Already have an account?{' '}
        <Link href="/login" className="text-cedar hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
