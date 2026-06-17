import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { claimInvite } from '@/actions/members'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Not signed in — send to auth with the invite URL as the return destination
  if (!user) {
    redirect(`/auth?next=/invite/${token}`)
  }

  // Signed in — attempt to claim immediately
  const result = await claimInvite(token)

  if (result.success) {
    redirect('/')
  }

  const errorMessages: Record<string, string> = {
    not_found: 'This invite link is invalid or has expired.',
    already_claimed: 'This invite link has already been used.',
    expired: 'This invite link has expired.',
    not_authenticated: 'You must be signed in to accept an invite.',
  }

  const message = result.error
    ? (errorMessages[result.error] ?? 'Something went wrong with this invite link.')
    : 'Something went wrong.'

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-3">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Link href="/" className="text-sm underline underline-offset-2">
          Go to Ringmark
        </Link>
      </div>
    </main>
  )
}
