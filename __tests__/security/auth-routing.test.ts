/**
 * Contract tests for the cached public surface: /p/[slug], its OG image, and /.
 *
 * The story page is served from the full-route cache (ISR). That gives it one
 * overriding property: it must be identical for every viewer. Anything that
 * depends on the request — a session, a cookie, a header — would either make
 * the route dynamic again (every QR scan becomes a function invocation, which
 * is the Vercel cost this design exists to avoid) or, worse, be rendered once
 * for one viewer and then served to everyone.
 *
 * Invariants pinned here:
 *
 *   1. NO SESSION READ on the cached routes. Enforced by an import allow-list,
 *      not just by grepping for getUser(): a helper that reads cookies() would
 *      otherwise slip through.
 *
 *   2. PUBLISHED GATE. Unpublished objects show a holding message to everyone.
 *      Unknown slugs are a real 404, not a cached 200.
 *
 *   3. CACHE CONTRACT. The routes opt into ISR explicitly and never opt back
 *      out; the photo URLs baked into the cached page use the long public
 *      lifetime (stale-while-revalidate means a page can be served long after
 *      its timed revalidate); and EVERY write function that can change a
 *      public page calls revalidatePublicStories() — checked per function,
 *      because a per-file check passed while saveStory had no purge at all.
 *
 *   4. MIDDLEWARE STAYS OFF THE PUBLIC PATH, and only the public path. The
 *      matcher is compiled and run against a table of paths, because a bare
 *      suffix once let /objects/maker skip the login gate.
 *
 * Source-text tests cannot prove runtime behaviour (caching only exists in a
 * production build — see docs/QA.md). They are regression guards that break
 * loudly on the specific mistakes that have already been made once.
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
const helperSrc = read('./lib/revalidate-public.ts')

const pageBodySrc = src.slice(src.indexOf('export default async function PublicStoryPage'))

/** Every module specifier imported by a source file. */
function imports(source: string): string[] {
  return [...source.matchAll(/^import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1])
}

/** Body of each `export async function NAME` in a file, keyed by name. */
function exportedFunctions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const chunks = source.split(/(?=^export async function )/m).slice(1)
  for (const chunk of chunks) {
    const name = /^export async function (\w+)/.exec(chunk)?.[1]
    if (name) out.set(name, chunk)
  }
  return out
}

// Modules a cached route may import. Anything that can touch the request
// (cookies, headers, the cookie-backed Supabase client, next/headers) is
// absent on purpose; adding one is a decision, so it must show up here.
const CACHED_ROUTE_IMPORT_ALLOWLIST = new Set([
  'react',
  'next',
  'next/image',
  'next/link',
  'next/navigation',
  'next/og',
  '@/lib/supabase/admin',
  '@/lib/constants',
  '@/lib/utils',
  '@/lib/signed-urls',
  '@/components/public-chrome',
  './stage-photo',
])

describe('auth routing — /p/[slug]', () => {
  it('imports only viewer-independent modules (no session, cookies or headers)', () => {
    for (const file of [src, ogSrc]) {
      for (const spec of imports(file)) {
        assert.ok(CACHED_ROUTE_IMPORT_ALLOWLIST.has(spec), `cached route imports "${spec}", which is not on the allow-list — if it is viewer-independent, add it there deliberately`)
      }
    }
    for (const marker of ['auth.getUser(', 'cookies(', 'headers(', 'isOwner']) {
      assert.ok(!src.includes(marker) && !ogSrc.includes(marker), `cached route must not contain "${marker}"`)
    }
  })

  it('opts into the full-route cache and never opts back out', () => {
    for (const [name, file] of [['page', src], ['opengraph-image', ogSrc]] as const) {
      assert.ok(/^export const revalidate = \d+$/m.test(file), `${name} must export a numeric revalidate`)
      assert.ok(file.includes('export function generateStaticParams'), `${name} must export generateStaticParams so dynamic slugs are cached on demand`)
      assert.ok(!/export const dynamic\b/.test(file), `${name} must not export a dynamic segment config — force-dynamic would silently undo the cache`)
    }
  })

  it('photo URLs baked into the cached page use the long public lifetime', () => {
    // Stale-while-revalidate means a page can be served long after its timed
    // revalidate, so the bound that matters is "URL lifetime >> any idle gap".
    assert.ok(src.includes("'object-photos', allPaths, PUBLIC_PHOTO_URL_EXPIRY)"), 'story page must sign photo URLs with PUBLIC_PHOTO_URL_EXPIRY')
    assert.ok(!src.includes('SIGNED_URL_EXPIRY'), 'story page must not use the admin SIGNED_URL_EXPIRY (one hour) inside cached HTML')
    const expr = /export const PUBLIC_PHOTO_URL_EXPIRY = ([\d\s*+()]+)$/m.exec(constantsSrc)?.[1]
    assert.ok(expr, 'PUBLIC_PHOTO_URL_EXPIRY must be a numeric expression')
    const seconds = Function(`return (${expr})`)() as number
    assert.ok(seconds >= 60 * 60 * 24 * 30, `PUBLIC_PHOTO_URL_EXPIRY is ${seconds}s; it must cover any plausible idle gap (at least 30 days)`)
  })

  it('unknown slug: real 404 (not a cached 200 placeholder)', () => {
    assert.ok(pageBodySrc.includes('if (!object) notFound()'), 'an unknown slug must call notFound()')
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
  it('the landing page reads no session; middleware owns its signed-in redirect', () => {
    for (const spec of imports(landingSrc)) {
      assert.ok(!spec.includes('supabase') && spec !== 'next/headers', `app/page.tsx must not import "${spec}"`)
    }
    assert.ok(!landingSrc.includes('auth.getUser('), 'app/page.tsx must not read the session')
    // Code, not a comment: an `if` that tests both the root path and the user.
    assert.ok(/^\s*if \(.*pathname === '\/'.*&& user\)/m.test(middlewareSrc), 'middleware must redirect a signed-in user away from / in code')
  })

  it('revalidatePublicStories purges the whole /p segment in the form Next honours', () => {
    // Without the 'layout' type, revalidatePath on a dynamic segment is a no-op.
    assert.ok(helperSrc.includes("revalidatePath('/p/[slug]', 'layout')"), "helper must call revalidatePath('/p/[slug]', 'layout')")
  })

  it('middleware matcher: compiled and run against real paths', () => {
    // The pattern is the first line inside `matcher: [` that starts with a
    // quote; comments above it contain apostrophes, so don't scan for one.
    const afterMatcher = middlewareSrc.slice(middlewareSrc.indexOf('matcher:'))
    const literal = /^\s*'((?:[^'\\]|\\.)*)'/m.exec(afterMatcher)?.[1]
    assert.ok(literal, 'middleware must export a matcher with a string pattern')
    // The pattern is a path-to-regexp custom group; for this shape it is a plain regex.
    const re = new RegExp('^' + literal.replace(/\\\\/g, '\\') + '$')

    const mustMatch = [
      '/', '/workshop', '/objects/abc', '/objects/maker', '/markets', '/markets/abc', '/markets/maker',
      '/settings', '/profile', '/login', '/oauth/consent', '/rafe/maker', '/makers',
    ]
    const mustNotMatch = [
      '/p/abc', '/p/abc/opengraph-image', '/maker', '/maker/opengraph-image', '/contact',
      '/robots.txt', '/sitemap.xml', '/api/mcp', '/api/upload', '/.well-known/oauth-protected-resource',
      '/_next/static/chunk.js', '/_next/image', '/favicon.ico', '/logo.png',
    ]
    for (const path of mustMatch) assert.ok(re.test(path), `middleware must run on ${path}`)
    for (const path of mustNotMatch) assert.ok(!re.test(path), `middleware must not run on ${path}`)
  })

  it('every write function that can change a public page purges the cache', () => {
    // name → functions that must purge. Anything exported but not listed is
    // asserted below to be one we have decided does not affect a public page.
    const required: Record<string, string[]> = {
      './actions/objects.ts': ['updateObject', 'deleteObject'],
      './actions/photos.ts': ['createPhotoRecord', 'deletePhoto', 'restorePhoto', 'updatePhotoCaption', 'togglePhotoVisibility', 'movePhoto'],
      './actions/story.ts': ['saveStory', 'publishObject', 'unpublishObject'],
      './actions/profile.ts': ['saveProfile'],
      './app/api/v1/objects/[id]/route.ts': ['PATCH', 'DELETE'],
      './app/api/v1/objects/[id]/photos/route.ts': ['POST'],
      './app/api/v1/objects/[id]/photos/[photoId]/route.ts': ['PATCH', 'DELETE'],
      './app/api/v1/objects/[id]/photos/[photoId]/restore/route.ts': ['POST'],
      './app/api/upload/route.ts': ['PUT'],
    }
    // Exported writes that do not change an existing public page, with the reason.
    const exempt: Record<string, Record<string, string>> = {
      './actions/objects.ts': {
        createObject: 'new objects start unpublished and have no page yet',
        updateStatus: 'delegates to updateObject, which purges',
        checkWorkshopId: 'read only',
        searchObjects: 'read only',
      },
      './app/api/v1/objects/[id]/route.ts': { GET: 'read only' },
      './app/api/v1/objects/[id]/photos/route.ts': { GET: 'read only' },
    }
    for (const [file, names] of Object.entries(required)) {
      const fns = exportedFunctions(read(file))
      for (const name of names) {
        const body = fns.get(name)
        assert.ok(body, `${file} must export ${name}`)
        assert.ok(body.includes('revalidatePublicStories()'), `${file} → ${name}() must call revalidatePublicStories() after a successful write`)
      }
      for (const name of fns.keys()) {
        assert.ok(names.includes(name) || exempt[file]?.[name], `${file} exports ${name}(), which is neither required to purge nor listed as exempt with a reason`)
      }
    }
    assert.ok(exportedFunctions(read('./actions/objects.ts')).get('updateStatus')?.includes('updateObject('), 'updateStatus must still delegate to updateObject')
  })
})
