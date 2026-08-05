/**
 * OAuth consent screen contract tests.
 *
 * Parses the source rather than running it — the page is a server component
 * that depends on next/headers and a live Supabase session, neither of which
 * exist in a bare test runner. What these catch is the class of regression
 * where a refactor removes a guard nobody remembers the reason for.
 *
 * See __tests__/security/action-ownership.test.ts for the same approach.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const consentSrc = readFileSync(resolve('./app/oauth/consent/page.tsx'), 'utf8')
const formSrc = readFileSync(resolve('./app/oauth/consent/consent-form.tsx'), 'utf8')

/** Source with comments removed, so prose about a symbol isn't mistaken for use of it. */
const consentCode = consentSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('oauth consent — account provisioning', () => {
  it('provisions an account before resolving the authorization request', () => {
    // Accounts are created lazily and this flow never touches an admin page:
    // authorize -> /login?next=/oauth/consent -> back here. Without this call a
    // user whose first authenticated action is an OAuth grant ends up with a
    // valid token, no account, and a permanent 401 from /api/mcp that offers
    // no clue why.
    const provisionIdx = consentSrc.indexOf('getOrCreateAccount()')
    const lookupIdx = consentSrc.indexOf('getAuthorizationDetails(')

    assert.ok(provisionIdx !== -1, 'consent page must call getOrCreateAccount()')
    assert.ok(lookupIdx !== -1, 'consent page must call getAuthorizationDetails()')
    assert.ok(
      provisionIdx < lookupIdx,
      'getOrCreateAccount() must run before the authorization lookup, so the ' +
      'expired/invalid branches still provision',
    )
  })
})

describe('oauth consent — phishing surface', () => {
  it('shows the redirect URI, which a registering client cannot freely fake', () => {
    assert.ok(
      consentSrc.includes('redirect_uri'),
      'consent screen must surface the redirect URI — with dynamic client ' +
      'registration open, the client name is attacker-chosen and the redirect ' +
      'target is the only trustworthy signal',
    )
  })

  it('never renders the client-supplied logo', () => {
    // logo_uri is an arbitrary remote URL from an unverified registrant.
    // Rendering it would put third-party branding on our own domain and leak
    // the user's IP to whoever registered the client.
    assert.ok(
      !consentCode.includes('logo_uri'),
      'consent screen must not render the client logo_uri',
    )
  })

  it('warns that the client name is unverified', () => {
    assert.ok(
      /not verified|unverified/i.test(consentSrc),
      'consent screen should tell the user the app name is self-reported',
    )
  })
})

describe('oauth consent — decision handling', () => {
  it('offers both approve and deny', () => {
    assert.ok(formSrc.includes('approveAuthorization'), 'consent form must offer approval')
    assert.ok(formSrc.includes('denyAuthorization'), 'consent form must offer denial')
  })
})
