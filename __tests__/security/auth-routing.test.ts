/**
 * Auth routing contract tests for /p/[slug].
 *
 * The public page has two critical security properties:
 *
 *   1. OWNER REDIRECT: a logged-in user who owns the object must be redirected
 *      to the admin view (/objects/[id]) — even if the object is unpublished.
 *      If this fires AFTER the is_published check, owners viewing their own
 *      unpublished work would hit the "not published yet" wall instead of admin.
 *
 *   2. PUBLISHED GATE: non-owners must only see the full public page when
 *      is_published is true. Unpublished objects must show a holding message.
 *
 * These tests parse app/p/[slug]/page.tsx as source text and assert that:
 *   - The server-side auth check (auth.getUser) is present
 *   - The owner comparison and redirect exist
 *   - The OWNER REDIRECT appears BEFORE the is_published gate (ordering invariant)
 *   - The public data SELECT only runs after all gates pass
 *   - Slugs not found in the DB return a not-found response (no crash, no redirect)
 *
 * Source-text tests cannot prove correctness at runtime; they are regression
 * guards that break loudly if the auth routing logic is accidentally reordered
 * or removed during a refactor.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve('./app/p/[slug]/page.tsx'), 'utf8')

describe('auth routing — /p/[slug]', () => {
  it('server-side auth: supabase.auth.getUser() is called (not a client-side hook)', () => {
    assert.ok(
      src.includes('auth.getUser()'),
      'must call supabase.auth.getUser() to identify the current user server-side',
    )
  })

  it('redirect is imported from next/navigation (server redirect, not client)', () => {
    assert.ok(
      src.includes("from 'next/navigation'"),
      "redirect must come from 'next/navigation' — client-side redirects would expose data before navigating",
    )
  })

  it('the auth check query selects account_id so ownership can be compared', () => {
    assert.ok(
      src.includes('account_id'),
      'the initial auth-check SELECT must include account_id to compare against the session account',
    )
  })

  it('owner identity is established by comparing account ids (not user ids)', () => {
    // The accounts table maps user → account; ownership is at the account level
    assert.ok(
      src.includes('authCheck.account_id'),
      'ownership check must compare against authCheck.account_id',
    )
  })

  it('owner is redirected to the admin object detail page', () => {
    assert.ok(
      src.includes('redirect(`/objects/'),
      'owner must be redirected to /objects/[id] (admin view)',
    )
  })

  it('ORDERING: owner redirect occurs BEFORE the is_published gate', () => {
    // Critical invariant: if an owner visits /p/slug for their OWN unpublished object,
    // they must reach the admin page — not the "hasn't been published yet" wall.
    // Reversing this order would mean owners can't navigate to their drafts via QR.
    const ownerRedirectIdx = src.indexOf('redirect(`/objects/')
    const publishedGateIdx = src.indexOf('!authCheck.is_published')

    assert.ok(ownerRedirectIdx !== -1, 'owner redirect must exist')
    assert.ok(publishedGateIdx !== -1, 'is_published gate must exist')
    assert.ok(
      ownerRedirectIdx < publishedGateIdx,
      'owner redirect MUST appear before the is_published check — ' +
      'owners of unpublished objects should reach admin, not the "not published" message',
    )
  })

  it('unknown slug: returns a not-found message (no crash, no redirect)', () => {
    assert.ok(
      src.includes('if (!authCheck)'),
      'must handle a slug that does not exist in the DB with a graceful message',
    )
  })

  it('non-owners see an explanatory message for unpublished objects (not a blank page)', () => {
    // JSX encodes apostrophes as &apos; — match both forms
    assert.ok(
      src.includes("hasn&apos;t been published yet") ||
      src.includes("hasn't been published yet") ||
      src.includes('not been published'),
      'unpublished objects must show an explanatory message to non-owners',
    )
  })

  it('ORDERING: public data SELECT only runs after both auth gates pass', () => {
    // The full public data fetch (the expensive query) must come AFTER:
    //   1. the owner redirect (owners never reach the public render path)
    //   2. the is_published gate (unpublished objects never reach the render path)
    const publicSelectMarker = "'id, public_slug, object_type"
    const ownerRedirectIdx = src.indexOf('redirect(`/objects/')
    const publishedGateIdx = src.indexOf('!authCheck.is_published')
    const publicSelectIdx = src.indexOf(publicSelectMarker)

    assert.ok(publicSelectIdx !== -1, 'public data SELECT must exist')
    assert.ok(
      ownerRedirectIdx < publicSelectIdx,
      'public data SELECT must come AFTER the owner redirect check',
    )
    assert.ok(
      publishedGateIdx < publicSelectIdx,
      'public data SELECT must come AFTER the is_published gate',
    )
  })

  it('photos are filtered by is_public = true on the public page', () => {
    assert.ok(
      src.includes(".eq('is_public', true)"),
      'photo query on the public page must filter to is_public = true',
    )
  })

  it('is_published filter is applied to the public data fetch', () => {
    assert.ok(
      src.includes(".eq('is_published', true)"),
      'public data query must include .eq(is_published, true) as a safety net',
    )
  })
})
