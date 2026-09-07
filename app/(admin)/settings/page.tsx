import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateAccount } from '@/lib/supabase/account'
import { createInvite } from '@/actions/members'
import { APP_URL } from '@/lib/constants'
import { ApiKeyManager } from '@/components/api-key-manager'

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

  // Fetch API keys for this account (service role needed to include created_by join)
  const { data: apiKeys } = await admin
    .from('api_keys')
    .select('id, key_prefix, label, created_at, last_used_at')
    .eq('account_id', account.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: true })

  const appUrl = APP_URL
  const newInviteUrl = newInviteToken ? `${appUrl}/invite/${newInviteToken}` : null

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-16">
      <div className="flex items-center justify-between mb-5">
        <Link href="/workshop" className="text-sm text-bark hover:text-ink">
          ← Back
        </Link>
      </div>

      <h1 className="text-lg font-medium mb-8">Settings</h1>

      {/* Members */}
      <section className="mb-10">
        <h2 className="text-xs text-bark tracking-wider mb-3">Members</h2>
        <div className="border border-hairline rounded-md divide-y divide-hairline">
          {memberDetails.map((m) => (
            <div key={m.userId} className="px-4 py-3">
              <p className="text-sm">{m.email}</p>
              <p className="text-xs text-bark mt-0.5">
                Joined {new Date(m.joinedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Invite */}
      <section className="mb-10">
        <h2 className="text-xs text-bark tracking-wider mb-3">Invite</h2>

        {newInviteUrl && (
          <div className="border border-hairline rounded-md px-4 py-3 mb-4 bg-sand/50">
            <p className="text-xs text-bark mb-1">Share this link — expires in 7 days</p>
            <p className="font-mono text-xs break-all">{newInviteUrl}</p>
          </div>
        )}

        {invites && invites.length > 0 && !newInviteUrl && (
          <div className="border border-hairline rounded-md divide-y divide-hairline mb-4">
            {invites.map((inv) => (
              <div key={inv.id} className="px-4 py-3">
                <p className="font-mono text-xs break-all">{appUrl}/invite/{inv.id}</p>
                <p className="text-xs text-bark mt-0.5">
                  Expires {new Date(inv.expires_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
              </div>
            ))}
          </div>
        )}

        <form action={createInvite}>
          <button
            type="submit"
            className="px-3 py-1.5 border border-hairline rounded-md text-sm hover:bg-sand transition-colors"
          >
            Generate invite link
          </button>
        </form>
        <p className="text-xs text-bark mt-2">
          The person you invite will need to create a Ringmark account or sign in, then follow the link.
        </p>
      </section>

      {/* API Keys */}
      <section className="mb-10">
        <h2 className="text-xs text-bark tracking-wider mb-3">API Keys</h2>
        <p className="text-xs text-bark mb-3">
          Keys authenticate requests to the REST API and MCP server. Each key is tied to this account.
          The raw key is shown once at creation — store it somewhere safe.
        </p>
        <ApiKeyManager keys={apiKeys ?? []} />
      </section>
    </main>
  )
}
