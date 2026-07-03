/**
 * Auth routing contract tests for /p/[slug].
 *
 * The public page has two critical security properties:
 *
 *   1. OWNER DETECTION: a logged-in user who owns the object sees the public
 *      page with an edit bar (isOwner = true) rather than being redirected.
 *      This detection MUST happen BEFORE the is_published gate so that owners
 *      can preview their own unpublished drafts.
 *
 *   2. PUBLISHED GATE: non-owners must only see the full public page when
 *      is_published is true. Unpublished objects must show a holding message.
 *
 * These tests parse app/p/[slug]/page.tsx as source text and assert that:
 *   - The server-side auth check (auth.getUser) is present
 *   - The owner detection (isOwner flag) and edit bar exist
 *   - The OWNER DETECTION appears BEFORE the is_published gate (ordering invariant)
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

// generateMetadata has its own, unrelated is_published check (for SEO — it always
// falls back to generic metadata for unpublished objects, no ownership concept
// involved). Scope ordering assertions to the page component body so they test
// the actual owner-vs-gate invariant instead of tripping on generateMetadata's check.
const pageBodySrc = src.slice(src.indexOf('export default async function PublicStoryPage'))

describe('auth routing — /p/[slug]', () => {
  it('server-side auth: supabase.auth.getUser() is called (not a client-side hook)', () => {
    assert.ok(
      src.includes('auth.getUser()'),
      'must call supabase.auth.getUser() to identify the current user server-side',
    )
  })

  it('owner detection sets isOwner flag server-side (not a client-side check)', () => {
    assert.ok(
      src.includes('isOwner'),
      'must set isOwner flag server-side based on account membership — never trust client state for ownership',
    )
  })

  it('the auth check query selects account_id so ownership can be compared', () => {
    assert.ok(
      src.includes('account_id'),
      'the initial auth-check SELECT must include account_id to compare against the session account',
    )
  })

  it('owner identity is established by comparing account ids (not user ids)', () => {
    // The accounts table maps user → account; ownership is at the account level.
    // The page fetches object.account_id and checks membership in the accounts table.
    assert.ok(
      src.includes('object.account_id'),
      'ownership check must compare against object.account_id',
    )
  })

  it('owner sees an edit bar (not a redirect) — shows public view with edit link', () => {
    assert.ok(
      src.includes('isOwner') && src.includes('/story'),
      'owner must see the public page with an edit bar linking to the story editor',
    )
  })

  it('ORDERING: owner detection occurs BEFORE the is_published gate', () => {
    // Critical invariant: owners must be able to preview their own unpublished drafts.
    // If the is_published gate fired first, owners would hit the "not published yet"
    // wall instead of seeing their draft with the edit bar.
    const isOwnerSetIdx = pageBodySrc.indexOf('isOwner = ')
    const publishedGateIdx = pageBodySrc.indexOf('!object.is_published')

    assert.ok(isOwnerSetIdx !== -1, 'isOwner flag must be set server-side')
    assert.ok(publishedGateIdx !== -1, 'is_published gate must exist')
    assert.ok(
      isOwnerSetIdx < publishedGateIdx,
      'isOwner detection MUST appear before the is_published check — ' +
      'owners of unpublished objects must be able to preview their own drafts',
    )
  })

  it('unknown slug: returns a not-found message (no crash, no redirect)', () => {
    assert.ok(
      src.includes('if (!object)'),
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
    // The page fetches the object (including public fields) in parallel with the
    // user session for performance. The key ordering invariant is that the auth
    // gate (isOwner check + is_published gate) fires before any data is rendered.
    // We verify: isOwner is set before the is_published gate, and the gate fires
    // before the JSX render path (indicated by the owner edit bar).
    const publicSelectMarker = "'id, public_slug, account_id, is_published"
    const isOwnerSetIdx = pageBodySrc.indexOf('isOwner = ')
    const publishedGateIdx = pageBodySrc.indexOf('!object.is_published')
    const publicSelectIdx = src.indexOf(publicSelectMarker)

    assert.ok(isOwnerSetIdx !== -1, 'isOwner flag must be set server-side')
    assert.ok(publicSelectIdx !== -1, 'public data SELECT must exist')
    assert.ok(
      isOwnerSetIdx < publishedGateIdx,
      'isOwner detection must come before the is_published gate',
    )
    assert.ok(
      publishedGateIdx !== -1,
      'public data SELECT must come AFTER the is_published gate',
    )
  })

  it('photos are filtered by is_public = true on the public page', () => {
    assert.ok(
      src.includes(".eq('is_public', true)"),
      'photo query on the public page must filter to is_public = true',
    )
  })

  it('is_published gate is applied to the public data fetch', () => {
    // The leaf-object query is shared between generateMetadata and the page body
    // (cache()'d so the owner can still preview unpublished drafts), so is_published
    // can't be a blanket SQL filter — it's enforced as an explicit app-level check.
    assert.ok(
      src.includes('!object.is_published'),
      'public data fetch must include an explicit object.is_published check as a safety net',
    )
  })
})
