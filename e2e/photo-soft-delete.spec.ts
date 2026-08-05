/**
 * Photo soft-delete tests.
 *
 * Photo deletion is reversible: the row is flagged rather than removed and the
 * storage file is retained so restore can bring it back. The privacy property
 * that makes that safe is that the object-photos bucket is private and every
 * public read mints a signed URL on demand — so a deleted photo becomes
 * unreachable purely by dropping out of the read paths.
 *
 * The assertions that matter most are the two public surfaces: the story page
 * and the OG share card. A "deleted" photo still visible there is the failure
 * this file exists to catch.
 *
 * Uses the REST API for setup so no browser/UI interaction is needed.
 */

import { test, expect } from '@playwright/test'

function apiHeaders(key = process.env.RINGMARK_API_KEY ?? '') {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

function uploadHeaders(key = process.env.RINGMARK_API_KEY ?? '') {
  return { Authorization: `Bearer ${key}` }
}

// Minimal 1×1 transparent PNG (67 bytes)
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890' +
  '000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
  'hex'
)

const RUN_TAG = `SOFTDEL${Date.now()}`

let objectId = ''
let slug = ''
let photoId = ''
/** Filename portion of storage_path — the part that shows up in signed URLs. */
let photoFile = ''
/** OG card bytes while the photo is live, for comparison after deletion. */
let ogWithPhoto: Buffer = Buffer.alloc(0)

test.beforeAll(async ({ request }) => {
  // Create, add a photo, give it a story, publish
  const create = await request.post('/api/v1/objects', {
    headers: apiHeaders(),
    data: {
      object_type: 'finished_bowl',
      workshop_id: `${RUN_TAG}`,
      title: 'Soft delete fixture',
    },
  })
  expect(create.status()).toBe(201)
  const obj = await create.json()
  objectId = obj.id
  slug = obj.public_slug

  const up = await request.post(`/api/v1/objects/${objectId}/photos`, {
    headers: uploadHeaders(),
    multipart: {
      file: { name: 'softdel.png', mimeType: 'image/png', buffer: MINIMAL_PNG },
      caption: 'Should vanish then return',
    },
  })
  expect(up.status()).toBe(201)
  const photo = await up.json()
  photoId = photo.id
  photoFile = String(photo.storage_path).split('/').pop() ?? ''
  expect(photoFile).not.toBe('')

  const publish = await request.patch(`/api/v1/objects/${objectId}`, {
    headers: apiHeaders(),
    data: { public_title: 'Soft Delete Fixture', is_published: true },
  })
  expect(publish.status()).toBe(200)

  // Baseline the share card while the photo is still live. The card is a
  // rendered PNG, so the only honest way to show the hero photo changed is to
  // compare the rendered bytes.
  const og = await request.get(ogUrl())
  expect(og.status()).toBe(200)
  ogWithPhoto = await og.body()
  expect(ogWithPhoto.byteLength).toBeGreaterThan(0)
})

/** Next serves the opengraph-image route directly under the page path. */
function ogUrl() {
  return `/p/${slug}/opengraph-image`
}

test.afterAll(async ({ request }) => {
  try {
    // force=true — the fixture is published
    await request.delete(`/api/v1/objects/${objectId}?force=true`, { headers: apiHeaders() })
  } catch { /* cleanup is best-effort */ }
})

// ── API semantics ─────────────────────────────────────────────────────────────

test('deleted photo drops out of the photo list but is still there with include_deleted', async ({ request }) => {
  const del = await request.delete(`/api/v1/objects/${objectId}/photos/${photoId}`, {
    headers: apiHeaders(),
  })
  expect(del.status()).toBe(204)

  const plain = await request.get(`/api/v1/objects/${objectId}/photos`, { headers: apiHeaders() })
  const plainIds = (await plain.json()).data.map((p: { id: string }) => p.id)
  expect(plainIds).not.toContain(photoId)

  const withDeleted = await request.get(
    `/api/v1/objects/${objectId}/photos?include_deleted=true`,
    { headers: apiHeaders() }
  )
  const rows = (await withDeleted.json()).data as Array<{ id: string; deleted_at: string | null }>
  const found = rows.find(p => p.id === photoId)
  expect(found, 'deleted photo should appear with include_deleted=true').toBeTruthy()
  expect(found?.deleted_at).toBeTruthy()
})

test('deleting an already-deleted photo → 404', async ({ request }) => {
  const again = await request.delete(`/api/v1/objects/${objectId}/photos/${photoId}`, {
    headers: apiHeaders(),
  })
  expect(again.status()).toBe(404)
})

// ── Public surfaces — the assertions that matter ──────────────────────────────

test('deleted photo is gone from the public story page', async ({ request }) => {
  const page = await request.get(`/p/${slug}`)
  expect(page.status()).toBe(200)
  const html = await page.text()
  expect(html).toContain('Soft Delete Fixture')          // page really rendered
  expect(html).not.toContain(photoFile)                   // photo did not
})

test('deleted photo is gone from the OG share card', async ({ request }) => {
  const og = await request.get(ogUrl())
  expect(og.status()).toBe(200)
  const ogWithout = await og.body()

  // Still renders (no crash when the only hero photo is gone) and is visibly
  // different from the card that had the photo in it.
  expect(ogWithout.byteLength).toBeGreaterThan(0)
  expect(
    ogWithout.equals(ogWithPhoto),
    'share card should change once its only photo is deleted',
  ).toBe(false)
})

test('lineage photo_count excludes deleted photos', async ({ request }) => {
  const r = await request.get(`/api/v1/objects/${objectId}/lineage`, { headers: apiHeaders() })
  expect(r.status()).toBe(200)
  const { steps } = await r.json()
  const step = steps.find((s: { workshop_id: string }) => s.workshop_id === RUN_TAG)
  expect(step, 'fixture should appear in its own lineage').toBeTruthy()
  expect(step.photo_count).toBe(0)
})

// ── Restore ───────────────────────────────────────────────────────────────────

test('restore brings the photo back to the list and the public page', async ({ request }) => {
  const restore = await request.post(`/api/v1/objects/${objectId}/photos/${photoId}/restore`, {
    headers: apiHeaders(),
  })
  expect(restore.status()).toBe(200)
  const restored = await restore.json()
  expect(restored.id).toBe(photoId)
  expect(restored.deleted_at ?? null).toBeNull()

  const list = await request.get(`/api/v1/objects/${objectId}/photos`, { headers: apiHeaders() })
  const ids = (await list.json()).data.map((p: { id: string }) => p.id)
  expect(ids).toContain(photoId)

  const page = await request.get(`/p/${slug}`)
  expect(await page.text()).toContain(photoFile)
})

test('restoring a photo that is not deleted → 404', async ({ request }) => {
  const r = await request.post(`/api/v1/objects/${objectId}/photos/${photoId}/restore`, {
    headers: apiHeaders(),
  })
  expect(r.status()).toBe(404)
})

test('restoring an unknown photo id → 404', async ({ request }) => {
  const r = await request.post(
    `/api/v1/objects/${objectId}/photos/00000000-0000-0000-0000-000000000000/restore`,
    { headers: apiHeaders() }
  )
  expect(r.status()).toBe(404)
})

test('restore without auth → 401', async ({ request }) => {
  const r = await request.post(`/api/v1/objects/${objectId}/photos/${photoId}/restore`)
  expect(r.status()).toBe(401)
})
