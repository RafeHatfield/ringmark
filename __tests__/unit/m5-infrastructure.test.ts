/**
 * M5 infrastructure tests.
 *
 * Verify that error boundaries, loading skeletons, not-found pages,
 * the delete button component, and the PWA manifest are all present
 * and structurally correct. These are fast existence + content checks
 * that catch the "file was accidentally deleted" and "required field
 * is missing from the manifest" classes of regression.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Error pages
// ---------------------------------------------------------------------------

describe('error boundaries', () => {
  it('global error.tsx exists', () => {
    assert.ok(existsSync(resolve('./app/error.tsx')), 'app/error.tsx must exist')
  })

  it('global error.tsx is a client component (required by Next.js for error boundaries)', () => {
    const src = readFileSync(resolve('./app/error.tsx'), 'utf8')
    assert.ok(
      src.includes("'use client'"),
      "app/error.tsx must have 'use client' — Next.js error boundaries must be client components",
    )
  })

  it('global error.tsx renders a reset button so users can recover', () => {
    const src = readFileSync(resolve('./app/error.tsx'), 'utf8')
    assert.ok(
      src.includes('reset'),
      'app/error.tsx must use the reset prop to allow the user to retry',
    )
  })
})

// ---------------------------------------------------------------------------
// Not-found pages
// ---------------------------------------------------------------------------

describe('not-found pages', () => {
  it('global not-found.tsx exists', () => {
    assert.ok(existsSync(resolve('./app/not-found.tsx')), 'app/not-found.tsx must exist')
  })

  it('global not-found.tsx links home', () => {
    const src = readFileSync(resolve('./app/not-found.tsx'), 'utf8')
    assert.ok(
      src.includes('href="/"'),
      'app/not-found.tsx must include a link back to the home page',
    )
  })

  it('object-level not-found.tsx exists for the admin detail route', () => {
    const path = resolve('./app/(admin)/objects/[id]/not-found.tsx')
    assert.ok(existsSync(path), 'app/(admin)/objects/[id]/not-found.tsx must exist')
  })

  it('object not-found page links to the workshop home', () => {
    const src = readFileSync(resolve('./app/(admin)/objects/[id]/not-found.tsx'), 'utf8')
    assert.ok(
      src.includes('href="/"'),
      'object not-found page must link back to the workshop home',
    )
  })
})

// ---------------------------------------------------------------------------
// Loading skeletons
// ---------------------------------------------------------------------------

describe('loading skeletons', () => {
  it('admin home loading.tsx exists', () => {
    assert.ok(
      existsSync(resolve('./app/(admin)/loading.tsx')),
      'app/(admin)/loading.tsx must exist for the home page skeleton',
    )
  })

  it('object detail loading.tsx exists', () => {
    assert.ok(
      existsSync(resolve('./app/(admin)/objects/[id]/loading.tsx')),
      'app/(admin)/objects/[id]/loading.tsx must exist for the detail page skeleton',
    )
  })

  it('loading skeletons use animate-pulse (Tailwind skeleton convention)', () => {
    const homeSrc = readFileSync(resolve('./app/(admin)/loading.tsx'), 'utf8')
    const detailSrc = readFileSync(resolve('./app/(admin)/objects/[id]/loading.tsx'), 'utf8')
    assert.ok(homeSrc.includes('animate-pulse'), 'home loading skeleton must use animate-pulse')
    assert.ok(detailSrc.includes('animate-pulse'), 'detail loading skeleton must use animate-pulse')
  })
})

// ---------------------------------------------------------------------------
// Delete object button
// ---------------------------------------------------------------------------

describe('delete object button', () => {
  it('DeleteObjectButton component exists', () => {
    assert.ok(
      existsSync(resolve('./components/delete-object-button.tsx')),
      'components/delete-object-button.tsx must exist',
    )
  })

  it('DeleteObjectButton is a client component', () => {
    const src = readFileSync(resolve('./components/delete-object-button.tsx'), 'utf8')
    assert.ok(
      src.includes("'use client'"),
      'DeleteObjectButton must be a client component',
    )
  })

  it('DeleteObjectButton calls the deleteObject server action', () => {
    const src = readFileSync(resolve('./components/delete-object-button.tsx'), 'utf8')
    assert.ok(
      src.includes('deleteObject'),
      'DeleteObjectButton must import and call the deleteObject action',
    )
  })

  it('DeleteObjectButton requires a confirmation step before deleting', () => {
    const src = readFileSync(resolve('./components/delete-object-button.tsx'), 'utf8')
    // The two-step pattern: a confirming state guards the actual deletion
    assert.ok(
      src.includes('confirming'),
      'DeleteObjectButton must use a confirmation state — accidental deletion must require two taps',
    )
  })

  it('detail page imports and renders DeleteObjectButton', () => {
    const src = readFileSync(resolve('./app/(admin)/objects/[id]/page.tsx'), 'utf8')
    assert.ok(
      src.includes('DeleteObjectButton'),
      'object detail page must render the DeleteObjectButton',
    )
  })
})

// ---------------------------------------------------------------------------
// PWA manifest
// ---------------------------------------------------------------------------

describe('PWA manifest', () => {
  it('public/manifest.json exists', () => {
    assert.ok(
      existsSync(resolve('./public/manifest.json')),
      'public/manifest.json must exist for PWA installability',
    )
  })

  it('manifest is valid JSON', () => {
    const raw = readFileSync(resolve('./public/manifest.json'), 'utf8')
    assert.doesNotThrow(() => JSON.parse(raw), 'public/manifest.json must be valid JSON')
  })

  it('manifest has required PWA fields: name, short_name, start_url, display', () => {
    const manifest = JSON.parse(readFileSync(resolve('./public/manifest.json'), 'utf8'))
    assert.ok(manifest.name, 'manifest must have a name')
    assert.ok(manifest.short_name, 'manifest must have a short_name')
    assert.ok(manifest.start_url, 'manifest must have a start_url')
    assert.ok(manifest.display, 'manifest must have a display mode')
  })

  it('manifest display mode is standalone (full-screen installable app)', () => {
    const manifest = JSON.parse(readFileSync(resolve('./public/manifest.json'), 'utf8'))
    assert.equal(
      manifest.display,
      'standalone',
      'manifest display must be "standalone" for proper home screen install behaviour',
    )
  })

  it('manifest start_url is root (/)', () => {
    const manifest = JSON.parse(readFileSync(resolve('./public/manifest.json'), 'utf8'))
    assert.equal(manifest.start_url, '/', 'manifest start_url must be "/" to open the workshop home')
  })

  it('manifest has theme_color for browser chrome colouring', () => {
    const manifest = JSON.parse(readFileSync(resolve('./public/manifest.json'), 'utf8'))
    assert.ok(manifest.theme_color, 'manifest must have a theme_color')
  })

  it('manifest references icons array', () => {
    const manifest = JSON.parse(readFileSync(resolve('./public/manifest.json'), 'utf8'))
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must list at least one icon')
  })

  it('every icon listed in the manifest actually exists in /public', () => {
    const manifest = JSON.parse(readFileSync(resolve('./public/manifest.json'), 'utf8'))
    const icons: { src: string }[] = manifest.icons ?? []
    for (const icon of icons) {
      const filePath = resolve(`./public${icon.src}`)
      assert.ok(
        existsSync(filePath),
        `manifest icon "${icon.src}" is listed but the file does not exist at ${filePath} — browser will 404 for every page load`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Layout mobile meta
// ---------------------------------------------------------------------------

describe('layout mobile meta', () => {
  it('layout.tsx exports a viewport config for mobile scaling', () => {
    const src = readFileSync(resolve('./app/layout.tsx'), 'utf8')
    assert.ok(
      src.includes('viewport'),
      'app/layout.tsx must export a viewport config (Next.js 14+ pattern)',
    )
  })

  it('layout.tsx includes appleWebApp capable flag', () => {
    const src = readFileSync(resolve('./app/layout.tsx'), 'utf8')
    assert.ok(
      src.includes('appleWebApp'),
      'app/layout.tsx must include appleWebApp metadata for iOS home screen install',
    )
  })
})
