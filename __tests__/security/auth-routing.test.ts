/**
 * Contract tests for /p/[slug], the public story page.
 *
 * The page is served from the full-route cache (ISR). That gives it one
 * overriding property: it must be identical for every viewer. Anything that
 * depends on the request — a session, a cookie, a header — would either make
 * the route dynamic again (every QR scan becomes a function invocation, which
 * is the Vercel cost this design exists to avoid) or, worse, be rendered once
 * for one viewer and then served to everyone.
 *
 * So the invariants are:
 *
 *   1. NO SESSION READ. The page never calls auth.getUser(), never creates the
 *      cookie-backed Supabase client, never reads cookies() or headers().
 *      The owner sees exactly what a buyer sees and edits from /objects/[id].
 *
 *   2. PUBLISHED GATE. Unpublished objects show a holding message, for
 *      everyone — there is no owner preview on this route any more.
 *
 *   3. CACHE CONTRACT. The route opts into ISR explicitly, its timed
 *      revalidate is shorter than the signed photo URL lifetime (so a cached
 *      page can never outlive its image links), and every write path that can
 *      change a public page purges the cache via revalidatePublicStories().
 *
 *   4. MIDDLEWARE STAYS OFF THE PUBLIC PATH. A middleware invocation per scan
 *      is the same cost in a different bucket.
 *
 * These are source-text regression guards, not runtime proofs. They break
 * loudly if someone reintroduces a session read or forgets the purge.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(p), 'utf8')

const src = read('./app/p/[slug]/page.tsx')
const ogSrc = read('./app/p/[slug]/opengraph-image.tsx')
const landingSrc = read('./app/page.tsx')
const middlewareSrc = read('./middleware.ts')
const constantsSrc = read('./lib/constants.ts')

const pageBodySrc = src.slice(src.indexOf('export default async function PublicStoryPage'))

describe('auth routing — /p/[slug]', () => {
  it('reads no session: no auth.getUser(), no cookie-backed client, no cookies()/headers()', () => {
    for (const marker of ['auth.getUser()', "from '@/lib/supabase/server'", 'cookies()', 'headers()', 'isOwner']) {
      assert.ok(
        !src.includes(marker),
        `/p/[slug] must not contain "${marker}" — the page is cached and must be identical for every viewer`,
      )
    }
  })

  it('opts into the full-route cache explicitly', () => {
    assert.ok(/export const revalidate = \d+/.test(src), 'page must export a numeric revalidate')
    assert.ok(src.includes('export function generateStaticParams'), 'page must export generateStaticParams so dynamic slugs are cached on demand')
  })

  it('timed revalidate is shorter than the signed photo URL lifetime', () => {
    const revalidate = Number(/export const revalidate = (\d+)/.exec(src)?.[1])
    const expiry = Number(/export const SIGNED_URL_EXPIRY = (\d+)/.exec(constantsSrc)?.[1])
    assert.ok(Number.isFinite(revalidate) && Number.isFinite(expiry), 'both numbers must be parseable')
    assert.ok(
      revalidate < expiry,
      `revalidate (${revalidate}s) must be below SIGNED_URL_EXPIRY (${expiry}s) or a cached page can serve expired image links`,
    )
  })

  it('unknown slug: returns a not-found message (no crash, no redirect)', () => {
    assert.ok(src.includes('if (!object)'), 'must handle a slug that does not exist in the DB with a graceful message')
  })

  it('unpublished objects show an explanatory message to everyone (there is no owner preview)', () => {
    assert.ok(pageBodySrc.includes('if (!object.is_published)'), 'is_published gate must exist and must not be conditioned on a viewer')
    assert.ok(
      src.includes("hasn&apos;t been published yet") ||
      src.includes("hasn't been published yet") ||
      src.includes('not been published'),
      'unpublished objects must show an explanatory message',
    )
  })

  it('ORDERING: the is_published gate fires before the lineage and photo fetches', () => {
    const gateIdx = pageBodySrc.indexOf('!object.is_published')
    const lineageIdx = pageBodySrc.indexOf(".eq('root_id'")
    const photosIdx = pageBodySrc.indexOf(".from('object_photos')")
    assert.ok(gateIdx !== -1 && lineageIdx !== -1 && photosIdx !== -1, 'gate, lineage and photo queries must all exist')
    assert.ok(gateIdx < lineageIdx && gateIdx < photosIdx, 'no public data may be fetched before the is_published gate')
  })

  it('photos are filtered by is_public = true on the public page', () => {
    assert.ok(src.includes(".eq('is_public', true)"), 'photo query on the public page must filter to is_public = true')
  })
})

describe('cache contract — public pages', () => {
  it('the story OG image is cached too (crawlers fetch it on every share)', () => {
    assert.ok(/export const revalidate = \d+/.test(ogSrc), 'opengraph-image must export revalidate')
    assert.ok(ogSrc.includes('export function generateStaticParams'), 'opengraph-image must export generateStaticParams')
    assert.ok(!ogSrc.includes('cookies()') && !ogSrc.includes('auth.getUser()'), 'opengraph-image must not read the request')
  })

  it('the landing page reads no session (its signed-in redirect lives in middleware)', () => {
    assert.ok(!landingSrc.includes("from '@/lib/supabase/server'") && !landingSrc.includes('auth.getUser()'), 'app/page.tsx must not read the session')
    assert.ok(middlewareSrc.includes("pathname === '/'"), 'middleware must own the / → /workshop redirect')
  })

  it('middleware does not match the public surface', () => {
    // The matcher is a negative lookahead; each public prefix must appear in it.
    // (Searching the whole file rather than a captured matcher: the pattern
    // contains "[^/]", which defeats a naive "up to the closing bracket" regex.)
    const matcherStart = middlewareSrc.indexOf('matcher:')
    assert.ok(matcherStart !== -1, 'middleware must export a matcher')
    const matcher = middlewareSrc.slice(matcherStart)
    for (const excluded of ['|p/|', '|maker|', '|[^/]+/maker$|']) {
      assert.ok(matcher.includes(excluded), `middleware matcher must exclude "${excluded}"`)
    }
  })

  it('every write path that can change a public page purges the cache', () => {
    const mustPurge = [
      './actions/story.ts',
      './app/api/v1/objects/[id]/route.ts',
      './app/api/v1/objects/[id]/photos/route.ts',
      './app/api/v1/objects/[id]/photos/[photoId]/route.ts',
      './app/api/v1/objects/[id]/photos/[photoId]/restore/route.ts',
      './app/api/upload/route.ts',
    ]
    for (const file of mustPurge) {
      assert.ok(read(file).includes('revalidatePublicStories()'), `${file} must call revalidatePublicStories() after a successful write`)
    }
    // The server actions for objects and photos purge per slug instead; either is acceptable.
    for (const file of ['./actions/objects.ts', './actions/photos.ts']) {
      const s = read(file)
      assert.ok(s.includes('revalidatePath(`/p/${') || s.includes('revalidatePublicStories()'), `${file} must revalidate the public page it changes`)
    }
  })
})
