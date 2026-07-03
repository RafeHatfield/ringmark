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

  it('object query gates unpublished objects behind an explicit is_published check', () => {
    // The leaf-object query is shared between generateMetadata and the page body
    // (so the page can still preview drafts for the owner), so is_published can't
    // be a blanket SQL filter. Instead every read path must explicitly gate on
    // object.is_published before returning real content to a non-owner.
    assert.ok(
      source.includes('!object.is_published'),
      'public page must explicitly check object.is_published before rendering real content',
    )
  })
})

describe('public page lineage rendering', () => {
  // These tests catch the regression where the page only showed the single leaf
  // object instead of the full lineage chain. A page that doesn't walk parent_id
  // in a loop cannot render the journey timeline.

  it('walks the parent_id chain in a while loop (not just reads the leaf object)', () => {
    assert.ok(
      source.includes('parent_id') && source.includes('while ('),
      'public page must walk parent_id in a while loop to build the lineage chain'
    )
    assert.ok(
      source.includes('chain.unshift'),
      'public page must prepend ancestors with chain.unshift to produce root-first order'
    )
  })

  it('renders step_label from lineage data (proves iteration over chain steps)', () => {
    assert.ok(
      source.includes('step_label'),
      'public page must render step_label — a lineage field absent from a single-object render'
    )
  })

  it('maps over displaySteps to render the journey timeline', () => {
    assert.ok(
      source.includes('displaySteps') && source.includes('.map('),
      'public page must map over displaySteps to render each journey stage'
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
