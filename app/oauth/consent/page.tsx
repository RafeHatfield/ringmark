import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ConsentForm } from './consent-form'

/**
 * OAuth 2.1 consent screen.
 *
 * Supabase Auth redirects here with an `authorization_id` when an OAuth client
 * asks for access. Dynamic client registration is enabled so MCP clients can
 * self-register, which means the client's *name* is attacker-controllable —
 * anyone can register "Ringmark Official". This screen is the only human gate
 * in the flow, so it leans on the one value that can't be faked: the redirect
 * URI, which is where the authorization code will actually be delivered.
 *
 * Deliberately not rendered: the client's logo_uri. Loading an arbitrary
 * remote image would let an unverified third party place trusted-looking
 * branding on our own domain, and would leak the user's IP to whoever
 * registered the client.
 */

export const dynamic = 'force-dynamic'

/** Plain-language descriptions for the scopes we expect to see. */
const SCOPE_LABELS: Record<string, string> = {
  openid: 'Confirm who you are',
  profile: 'Read your basic profile',
  email: 'Read your email address',
}

function describeScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>
}) {
  const { authorization_id: authorizationId } = await searchParams

  if (!authorizationId) {
    return (
      <Shell title="Nothing to approve">
        <p className="text-sm text-bark">
          This page is part of the sign-in flow for apps connecting to Ringmark. It
          only works when opened from that flow.
        </p>
      </Shell>
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)

  if (error || !data) {
    return (
      <Shell title="This request has expired">
        <p className="text-sm text-bark">
          {error?.message ?? 'The authorization request could not be found.'} Start the
          connection again from the app you were using.
        </p>
      </Shell>
    )
  }

  // Already consented to these scopes — Supabase hands back a redirect instead
  // of authorization details, and there is nothing to ask the user.
  if (!('authorization_id' in data)) {
    redirect(data.redirect_url)
  }

  const scopes = data.scope.split(' ').filter(Boolean)

  return (
    <Shell title="Connect to Ringmark">
      <div className="space-y-5">
        <p className="text-sm text-bark">
          <span className="font-medium text-ink">{data.client.name}</span> wants access
          to your workshop as{' '}
          <span className="font-medium text-ink">{data.user.email}</span>.
        </p>

        <div className="rounded-md border border-hairline bg-sand/50 px-3 py-2.5 space-y-1">
          <p className="text-xs uppercase tracking-wide text-bark">Sends you back to</p>
          <p className="text-sm font-mono text-ink break-all">{hostOf(data.redirect_uri)}</p>
          <p className="text-xs text-bark pt-1">
            Only continue if you recognise this. The app name above is chosen by whoever
            registered it and is not verified.
          </p>
        </div>

        {scopes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs uppercase tracking-wide text-bark">It will be able to</p>
            <ul className="space-y-1">
              {scopes.map(scope => (
                <li key={scope} className="text-sm text-ink flex gap-2">
                  <span aria-hidden className="text-bark">•</span>
                  {describeScope(scope)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <ConsentForm authorizationId={data.authorization_id} />
      </div>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
