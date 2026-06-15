import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateSlug } from '../../lib/slug-gen.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/types.ts'

// Proxy that resolves with { data: null } (slug available) or { data: {id:'x'} } (taken)
function makeSupabaseMock(isTaken: () => boolean): SupabaseClient<Database> {
  let proxy: object
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        const taken = isTaken()
        return (resolve: (v: { data: { id: string } | null; error: null }) => unknown) =>
          Promise.resolve({ data: taken ? { id: 'x' } : null, error: null }).then(resolve)
      }
      if (typeof prop === 'symbol') return undefined
      return () => proxy
    },
  }
  proxy = new Proxy({}, handler)
  return { from: () => ({ select: () => proxy }) } as unknown as SupabaseClient<Database>
}

const ALLOWED_CHARSET = /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/
const AMBIGUOUS_CHARS = /[0OIl1]/

describe('generateSlug', () => {
  it('generates a slug of exactly 8 characters', async () => {
    const slug = await generateSlug(makeSupabaseMock(() => false))
    assert.equal(slug.length, 8)
  })

  it('only uses characters from the allowed charset', async () => {
    const slug = await generateSlug(makeSupabaseMock(() => false))
    assert.match(slug, ALLOWED_CHARSET)
  })

  it('never includes visually ambiguous characters (0 O I l 1)', async () => {
    for (let i = 0; i < 100; i++) {
      const slug = await generateSlug(makeSupabaseMock(() => false))
      assert.doesNotMatch(slug, AMBIGUOUS_CHARS, `Ambiguous char found in slug: ${slug}`)
    }
  })

  it('retries when a slug is already taken', async () => {
    let callCount = 0
    // First 2 calls return "taken", 3rd is free
    const isTaken = () => { callCount++; return callCount <= 2 }
    const slug = await generateSlug(makeSupabaseMock(isTaken))
    assert.equal(callCount, 3)
    assert.equal(slug.length, 8)
  })

  it('throws after 10 consecutive collisions', async () => {
    const alwaysTaken = makeSupabaseMock(() => true)
    await assert.rejects(
      () => generateSlug(alwaysTaken),
      /unique slug/i,
    )
  })

  it('produces unique slugs across multiple calls', async () => {
    const slugs = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const slug = await generateSlug(makeSupabaseMock(() => false))
      slugs.add(slug)
    }
    // 20 random 8-char slugs from a 54-char alphabet should almost certainly all differ
    assert.ok(slugs.size > 15, `Expected high uniqueness, got ${slugs.size}/20 unique`)
  })
})
