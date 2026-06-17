import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createInvite } from '@/actions/members'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>
}) {
  const { invite: newInviteToken } = await searchParams
  const account = await getOrCreateAccount()
  const admin = createAdminClient()

  // Fetch all members — uses service role to bypass RLS (RLS only exposes own row)
  const { data: members } = await admin
    .from('account_members')
    .select('user_id, joined_at')
    .eq('account_id', account.id)
    .order('joined_at')

  // Resolve emails from auth.users
  const memberDetails: { userId: string; email: string; joinedAt: string }[] = []
  if (members) {
    for (const m of members) {
      const { data: userData } = await admin.auth.admin.getUserById(m.user_id)
      memberDetails.push({
        userId: m.user_id,
        email: userData.user?.email ?? m.user_id,
        joinedAt: m.joined_at,
      })
    }
  }

  // Fetch active (unclaimed, unexpired) invites
  const { data: invites } = await admin
    .from('account_invites')
    .select('id, expires_at, claimed_at')
    .eq('account_id', account.id)
    .is('claimed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const newInviteUrl = newInviteToken ? `${appUrl}/invite/${newInviteToken}` : null

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16">
      <div className="flex items-center justify-between mb-5">
        <Link href="/workshop" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <h1 className="text-lg font-medium mb-8">Settings</h1>

      {/* Members */}
      <section className="mb-10">
        <h2 className="text-xs text-muted-foreground tracking-wider mb-3">Members</h2>
        <div className="border rounded-md divide-y divide-border">
          {memberDetails.map((m) => (
            <div key={m.userId} className="px-4 py-3">
              <p className="text-sm">{m.email}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Joined {new Date(m.joinedAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Invite */}
      <section className="mb-10">
        <h2 className="text-xs text-muted-foreground tracking-wider mb-3">Invite</h2>

        {newInviteUrl && (
          <div className="border rounded-md px-4 py-3 mb-4 bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">Share this link — expires in 7 days</p>
            <p className="font-mono text-xs break-all">{newInviteUrl}</p>
          </div>
        )}

        {invites && invites.length > 0 && !newInviteUrl && (
          <div className="border rounded-md divide-y divide-border mb-4">
            {invites.map((inv) => (
              <div key={inv.id} className="px-4 py-3">
                <p className="font-mono text-xs break-all">{appUrl}/invite/{inv.id}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Expires {new Date(inv.expires_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}

        <form action={createInvite}>
          <button
            type="submit"
            className="px-3 py-1.5 border border-input rounded-md text-sm hover:bg-accent transition-colors"
          >
            Generate invite link
          </button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          The person you invite will need to create a Ringmark account or sign in with Google, then follow the link.
        </p>
      </section>
    </main>
  )
}
