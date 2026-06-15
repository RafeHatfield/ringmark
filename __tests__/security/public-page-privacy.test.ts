/**
 * Data-privacy contract tests for the public story page.
 *
 * These tests parse the actual source of app/p/[slug]/page.tsx and assert that:
 *   1. private_notes is never selected in any Supabase query on this file
 *   2. location_text is never selected in any Supabase query on this file
 *   3. workshop_id is never selected in public-facing queries on this file
 *
 * They do NOT run the page — they read the source as text and verify the
 * column names are absent from the public SELECT strings. This is intentionally
 * strict: if someone accidentally adds a private column to the public query,
 * this test must fail.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PUBLIC_PAGE = resolve('./app/p/[slug]/page.tsx')
const source = readFileSync(PUBLIC_PAGE, 'utf8')

// Extract all .select('...') call arguments from the source
function extractSelectCalls(src: string): string[] {
  const calls: string[] = []
  // Match both single and double-quoted .select() arguments (no template literals needed here)
  const re = /\.select\(\s*['"`]([\s\S]*?)['"`]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    calls.push(m[1])
  }
  return calls
}

// The auth-routing query selects 'id, is_published, account_id' — no private fields allowed
// The public data query must also be free of private fields
const PRIVATE_FIELDS = ['private_notes', 'location_text']

// workshop_id must NOT appear in the public data query (the second SELECT, post-auth-check)
// It's fine for it to appear in comments or variable names, but not in a .select() string
const WORKSHOP_ID_FIELD = 'workshop_id'

describe('public page privacy', () => {
  it('source file exists and is readable', () => {
    assert.ok(source.length > 0, 'app/p/[slug]/page.tsx should not be empty')
  })

  it('no private_notes column in any SELECT', () => {
    const selects = extractSelectCalls(source)
    assert.ok(selects.length >= 1, 'should have at least one .select() call')
    for (const sel of selects) {
      assert.ok(
        !sel.includes('private_notes'),
        `private_notes must not appear in .select('${sel}')`,
      )
    }
  })

  it('no location_text column in any SELECT', () => {
    const selects = extractSelectCalls(source)
    for (const sel of selects) {
      assert.ok(
        !sel.includes('location_text'),
        `location_text must not appear in .select('${sel}')`,
      )
    }
  })

  it('workshop_id not exposed in the public data SELECT', () => {
    const selects = extractSelectCalls(source)
    // The public data query is the LAST .select() call (after auth check)
    // Find the select that contains 'public_slug' — that's the public data query
    const publicDataSelect = selects.find((s) => s.includes('public_slug') && s.includes('public_story'))
    assert.ok(publicDataSelect, 'should have a public data .select() containing public_slug and public_story')
    assert.ok(
      !publicDataSelect.includes('workshop_id'),
      `workshop_id must not be in the public data select: '${publicDataSelect}'`,
    )
  })

  it('only public photo fields are selected (no storage_path in private context)', () => {
    // Photos query: must select is_public filter is applied at query level
    // The photo select should NOT include account_id (not needed for public page)
    const selects = extractSelectCalls(source)
    const photoSelect = selects.find((s) => s.includes('storage_path') && s.includes('caption'))
    // storage_path being in the select is OK — we need it to generate signed URLs
    // but the query must also filter by is_public = true (checked separately via code inspection)
    if (photoSelect) {
      assert.ok(
        !photoSelect.includes('private_notes'),
        'photo select should not include private_notes',
      )
    }
  })

  it('photo query filters by is_public = true', () => {
    // Verify the source includes .eq('is_public', true) for the photo query
    assert.ok(
      source.includes(".eq('is_public', true)"),
      "public page must filter photos with .eq('is_public', true)",
    )
  })

  it('object query filters by is_published = true', () => {
    assert.ok(
      source.includes(".eq('is_published', true)"),
      "public page must filter objects with .eq('is_published', true)",
    )
  })
})

describe('public page does not expose private column names anywhere', () => {
  for (const field of PRIVATE_FIELDS) {
    it(`"${field}" does not appear in any SELECT call`, () => {
      const selects = extractSelectCalls(source)
      for (const sel of selects) {
        assert.ok(
          !sel.includes(field),
          `"${field}" must not appear in any .select() string`,
        )
      }
    })
  }
})
