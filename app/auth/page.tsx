'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleRequestCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithOtp({ email })

    if (authError) {
      setError(authError.message)
    } else {
      setCodeSent(true)
    }
    setLoading(false)
  }

  async function handleVerifyCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'magiclink',
    })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  if (codeSent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Ringmark</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Check <strong>{email}</strong> for a 6-digit code.
            </p>
          </div>
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="token" className="block text-sm font-medium">
                Code
              </label>
              <input
                id="token"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                required
                autoFocus
                autoComplete="one-time-code"
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring tracking-widest text-center text-lg"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading || token.length < 6}
              className="w-full bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => { setCodeSent(false); setToken(''); setError('') }}
              className="w-full text-sm text-muted-foreground hover:text-foreground"
            >
              Use a different email
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Ringmark</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your workshop</p>
        </div>
        <form onSubmit={handleRequestCode} className="space-y-4">
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
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-md px-4 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </form>
      </div>
    </div>
  )
}
