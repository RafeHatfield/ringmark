/**
 * Signed direct photo upload.
 *
 * Two-step flow: an authenticated call reserves a photo row and mints a
 * single-use token, then the bytes are PUT to /api/upload with that token. The
 * point is that the image never passes through the calling model's context, so
 * full-resolution photos become practical from a hosted MCP client.
 *
 * /api/upload is the only write endpoint in the app authenticated by something
 * other than an account credential, so the assertions that matter are the ones
 * bounding what a token can do: it works once, it expires, it only ever writes
 * to the one row it was minted for, and it will not accept a non-image.
 *
 * The other property under test is that a pending reservation is invisible
 * everywhere — most importantly on the public story page, where a row with no
 * bytes behind it would render a broken image.
 */

import { test, expect } from '@playwright/test'
import { updatePhotoAdmin, getPhotoRowAdmin } from './helpers/supabase-admin'

function apiHeaders(key = process.env.RINGMARK_API_KEY ?? '') {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

// Minimal 1×1 transparent PNG (67 bytes)
const MINIMAL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890' +
  '000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
  'hex'
)

/** Real 17×43 PNG, so dimension parsing is asserted against a non-square image. */
const PNG_17x43 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABEAAAArCAIAAAAR7vRmAAAAMElEQVR4nO3QsQ0AIBDDQH/Yf2ckmCDty+6v8UwOZWmB5hX6okGDBo0PfqEvGraZC7S5AFwqWXPZAAAAAElFTkSuQmCC',
  'base64',
)

/** Valid HEIC header. Accepted for storage, but deliberately not measured. */
const HEIC_HEADER = (() => {
  const b = Buffer.alloc(64)
  b.writeUInt32BE(64, 0)
  b.write('ftyp', 4, 'ascii')
  b.write('heic', 8, 'ascii')
  return b
})()

const RUN_TAG = `DIRECTUP${Date.now()}`

let objectId = ''
let slug = ''

type Reservation = {
  photo_id: string
  upload_url: string
  upload_token: string
  expires_at: string
  max_bytes: number
  accepted_types: string[]
  instructions: string
}

async function reserve(
  request: import('@playwright/test').APIRequestContext,
  body: Record<string, unknown> = { filename: 'shot.png' },
): Promise<Reservation> {
  const res = await request.post(`/api/v1/objects/${objectId}/photos/upload-url`, {
    headers: apiHeaders(),
    data: body,
  })
  expect(res.status()).toBe(201)
  return res.json()
}

/** PUTs raw bytes with the token in the Authorization header. */
function put(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  body: Buffer,
  contentType = 'image/png',
) {
  return request.put('/api/upload', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    data: body,
  })
}

test.beforeAll(async ({ request }) => {
  const create = await request.post('/api/v1/objects', {
    headers: apiHeaders(),
    data: {
      object_type: 'finished_bowl',
      workshop_id: RUN_TAG,
      title: 'Direct upload fixture',
    },
  })
  expect(create.status()).toBe(201)
  const obj = await create.json()
  objectId = obj.id
  slug = obj.public_slug

  const publish = await request.patch(`/api/v1/objects/${objectId}`, {
    headers: apiHeaders(),
    data: { public_title: 'Direct Upload Fixture', is_published: true },
  })
  expect(publish.status()).toBe(200)
})

test.afterAll(async ({ request }) => {
  try {
    await request.delete(`/api/v1/objects/${objectId}?force=true`, { headers: apiHeaders() })
  } catch { /* cleanup is best-effort */ }
})

// ── Reservation ───────────────────────────────────────────────────────────────

test('reserving an upload returns a token and a runnable curl command', async ({ request }) => {
  const r = await reserve(request, { filename: 'IMG_1719.jpeg', caption: 'From the lathe' })

  expect(r.photo_id).toBeTruthy()
  expect(r.upload_url).toMatch(/\/api\/upload$/)
  expect(r.upload_token.length).toBeGreaterThan(40)
  expect(r.max_bytes).toBe(4_000_000)
  expect(r.accepted_types).toContain('image/jpeg')
  // The calling model has to run this verbatim, so it must be complete.
  expect(r.instructions).toContain('curl')
  expect(r.instructions).toContain(r.upload_token)
  expect(r.instructions).toContain(r.upload_url)

  // Expiry is 15 minutes out, give or take clock skew.
  const ttlMs = new Date(r.expires_at).getTime() - Date.now()
  expect(ttlMs).toBeGreaterThan(13 * 60_000)
  expect(ttlMs).toBeLessThan(16 * 60_000)
})

test('only the token hash is persisted, never the token itself', async ({ request }) => {
  const r = await reserve(request)
  const row = await getPhotoRowAdmin(r.photo_id)

  expect(row).toBeTruthy()
  expect(row!.status).toBe('pending')
  expect(row!.upload_token_hash).toBeTruthy()
  expect(row!.upload_token_hash).not.toBe(r.upload_token)
  expect(String(row!.upload_token_hash)).toHaveLength(64)
  expect(row!.upload_consumed_at).toBeNull()
  // The plaintext must not have leaked into any other column.
  expect(JSON.stringify(row)).not.toContain(r.upload_token)
})

test('reserving requires a filename', async ({ request }) => {
  const res = await request.post(`/api/v1/objects/${objectId}/photos/upload-url`, {
    headers: apiHeaders(),
    data: {},
  })
  expect(res.status()).toBe(400)
})

test('reserving against an object the account does not own → 404', async ({ request }) => {
  const res = await request.post(
    '/api/v1/objects/00000000-0000-0000-0000-000000000000/photos/upload-url',
    { headers: apiHeaders(), data: { filename: 'shot.png' } },
  )
  expect(res.status()).toBe(404)
})

test('reserving without auth → 401', async ({ request }) => {
  const res = await request.post(`/api/v1/objects/${objectId}/photos/upload-url`, {
    data: { filename: 'shot.png' },
  })
  expect(res.status()).toBe(401)
})

// ── Pending rows are invisible ────────────────────────────────────────────────

test('a pending reservation is absent from the photo list and the public page', async ({ request }) => {
  const r = await reserve(request)

  const list = await request.get(`/api/v1/objects/${objectId}/photos`, { headers: apiHeaders() })
  const ids = (await list.json()).data.map((p: { id: string }) => p.id)
  expect(ids).not.toContain(r.photo_id)

  // Even with include_deleted, which relaxes the *other* filter.
  const withDeleted = await request.get(
    `/api/v1/objects/${objectId}/photos?include_deleted=true`,
    { headers: apiHeaders() },
  )
  const allIds = (await withDeleted.json()).data.map((p: { id: string }) => p.id)
  expect(allIds).not.toContain(r.photo_id)

  const row = await getPhotoRowAdmin(r.photo_id)
  const file = String(row!.storage_path).split('/').pop()
  const page = await request.get(`/p/${slug}`)
  expect(page.status()).toBe(200)
  const html = await page.text()
  expect(html).toContain('Direct Upload Fixture')  // page really rendered
  expect(html).not.toContain(file)                 // reservation did not
})

test('confirm reports a pending reservation with a next step, and no signed URL', async ({ request }) => {
  const r = await reserve(request)
  const res = await request.get(`/api/v1/photos/${r.photo_id}`, { headers: apiHeaders() })
  expect(res.status()).toBe(200)

  const photo = await res.json()
  expect(photo.status).toBe('pending')
  expect(photo.upload_state).toBe('usable')
  expect(photo.signed_url).toBeNull()
  expect(photo.bytes).toBeNull()
  expect(photo.message).toContain('/api/upload')
})

// ── Redemption ────────────────────────────────────────────────────────────────

test('uploading the bytes makes the photo live and puts it on the public page', async ({ request }) => {
  const r = await reserve(request, { filename: 'hero.png', caption: 'Direct upload hero' })

  const res = await put(request, r.upload_token, MINIMAL_PNG)
  expect(res.status()).toBe(200)

  const photo = await res.json()
  expect(photo.id).toBe(r.photo_id)
  expect(photo.status).toBe('live')
  expect(photo.bytes).toBe(MINIMAL_PNG.byteLength)
  expect(photo.caption).toBe('Direct upload hero')
  expect(photo.signed_url).toBeTruthy()

  // The reservation columns are cleared, so the token cannot resolve again.
  const row = await getPhotoRowAdmin(r.photo_id)
  expect(row!.upload_token_hash).toBeNull()
  expect(row!.upload_consumed_at).toBeTruthy()

  const list = await request.get(`/api/v1/objects/${objectId}/photos`, { headers: apiHeaders() })
  const ids = (await list.json()).data.map((p: { id: string }) => p.id)
  expect(ids).toContain(r.photo_id)

  const file = String(photo.storage_path).split('/').pop()
  const page = await request.get(`/p/${slug}`)
  expect(await page.text()).toContain(file)
})

test('a token works exactly once', async ({ request }) => {
  const r = await reserve(request)

  expect((await put(request, r.upload_token, MINIMAL_PNG)).status()).toBe(200)

  // Second attempt: the hash was nulled on consumption, so this is
  // indistinguishable from an unknown token — deliberately.
  const again = await put(request, r.upload_token, MINIMAL_PNG)
  expect([404, 410]).toContain(again.status())
})

test('an expired token is refused and says how to recover', async ({ request }) => {
  const r = await reserve(request)
  await updatePhotoAdmin(r.photo_id, {
    upload_expires_at: new Date(Date.now() - 60_000).toISOString(),
  })

  const res = await put(request, r.upload_token, MINIMAL_PNG)
  expect(res.status()).toBe(410)
  expect((await res.json()).error).toContain('create_upload_url')

  // The row is untouched, so the sweep can still clean it up.
  const row = await getPhotoRowAdmin(r.photo_id)
  expect(row!.status).toBe('pending')

  const confirm = await request.get(`/api/v1/photos/${r.photo_id}`, { headers: apiHeaders() })
  expect((await confirm.json()).upload_state).toBe('expired')
})

test('an unknown token → 404', async ({ request }) => {
  const res = await put(request, 'not-a-real-token', MINIMAL_PNG)
  expect(res.status()).toBe(404)
})

test('a missing Authorization header → 401', async ({ request }) => {
  const res = await request.put('/api/upload', {
    headers: { 'Content-Type': 'image/png' },
    data: MINIMAL_PNG,
  })
  expect(res.status()).toBe(401)
})

// ── What the bytes are allowed to be ──────────────────────────────────────────

test('a text file renamed .jpg is refused and the token survives', async ({ request }) => {
  const r = await reserve(request, { filename: 'trojan.jpg' })

  const res = await put(request, r.upload_token, Buffer.from('#!/bin/sh\nrm -rf /\n'), 'image/jpeg')
  expect(res.status()).toBe(415)

  // Content-Type said image/jpeg; the bytes decided otherwise.
  const row = await getPhotoRowAdmin(r.photo_id)
  expect(row!.status).toBe('pending')

  // A rejected attempt does not burn the reservation.
  expect((await put(request, r.upload_token, MINIMAL_PNG)).status()).toBe(200)
})

test('an oversized body is refused and the token survives', async ({ request }) => {
  const r = await reserve(request)

  // Valid PNG header, then padding past the 4 MB cap.
  const oversized = Buffer.concat([MINIMAL_PNG, Buffer.alloc(4_100_000)])
  const res = await put(request, r.upload_token, oversized)
  expect(res.status()).toBe(413)

  const row = await getPhotoRowAdmin(r.photo_id)
  expect(row!.status).toBe('pending')

  expect((await put(request, r.upload_token, MINIMAL_PNG)).status()).toBe(200)
})

test('an empty body is refused', async ({ request }) => {
  const r = await reserve(request)
  const res = await put(request, r.upload_token, Buffer.alloc(0))
  expect(res.status()).toBe(400)
})

test('the stored extension follows the actual bytes, not the claimed filename', async ({ request }) => {
  // Filename says .heic; the bytes are a PNG. The sniffed format wins, so the
  // storage path cannot be steered by the caller's filename.
  const r = await reserve(request, { filename: 'mislabelled.heic' })
  const res = await put(request, r.upload_token, MINIMAL_PNG, 'image/heic')
  expect(res.status()).toBe(200)
  expect((await res.json()).storage_path).toMatch(/\.png$/)
})

// ── Dimensions ────────────────────────────────────────────────────────────────

test('dimensions are recorded from the uploaded bytes', async ({ request }) => {
  const r = await reserve(request, { filename: 'sized.png' })
  const res = await put(request, r.upload_token, PNG_17x43)
  expect(res.status()).toBe(200)

  const photo = await res.json()
  expect(photo.width).toBe(17)
  expect(photo.height).toBe(43)
  expect(photo.bytes).toBe(PNG_17x43.byteLength)

  // And they survive the round trip through the confirm endpoint.
  const confirm = await request.get(`/api/v1/photos/${r.photo_id}`, { headers: apiHeaders() })
  const fetched = await confirm.json()
  expect(fetched.width).toBe(17)
  expect(fetched.height).toBe(43)
})

test('HEIC uploads succeed but are left unmeasured', async ({ request }) => {
  // The dimensions live in a nested ISO-BMFF box we deliberately do not parse.
  // Null must mean unknown here — never zero, which would break any layout
  // arithmetic downstream.
  const r = await reserve(request, { filename: 'phone.heic' })
  const res = await put(request, r.upload_token, HEIC_HEADER, 'image/heic')
  expect(res.status()).toBe(200)

  const photo = await res.json()
  expect(photo.status).toBe('live')
  expect(photo.width).toBeNull()
  expect(photo.height).toBeNull()
  expect(photo.bytes).toBe(HEIC_HEADER.byteLength)
})

test('the multipart upload path records dimensions identically', async ({ request }) => {
  // Both upload routes must agree, or the two paths quietly diverge.
  const up = await request.post(`/api/v1/objects/${objectId}/photos`, {
    headers: { Authorization: `Bearer ${process.env.RINGMARK_API_KEY ?? ''}` },
    multipart: {
      file: { name: 'multipart.png', mimeType: 'image/png', buffer: PNG_17x43 },
      caption: 'Via multipart',
    },
  })
  expect(up.status()).toBe(201)

  const photo = await up.json()
  expect(photo.width).toBe(17)
  expect(photo.height).toBe(43)
  expect(photo.bytes).toBe(PNG_17x43.byteLength)
})

// ── confirm_upload backing endpoint ───────────────────────────────────────────

test('confirm reports a live photo with its size and a signed URL', async ({ request }) => {
  const r = await reserve(request)
  expect((await put(request, r.upload_token, MINIMAL_PNG)).status()).toBe(200)

  const res = await request.get(`/api/v1/photos/${r.photo_id}`, { headers: apiHeaders() })
  const photo = await res.json()
  expect(photo.status).toBe('live')
  expect(photo.upload_state).toBeNull()
  expect(photo.bytes).toBe(MINIMAL_PNG.byteLength)
  expect(photo.signed_url).toBeTruthy()
})

test('confirm on an unknown photo id → 404', async ({ request }) => {
  const res = await request.get(
    '/api/v1/photos/00000000-0000-0000-0000-000000000000',
    { headers: apiHeaders() },
  )
  expect(res.status()).toBe(404)
})

test('confirm without auth → 401', async ({ request }) => {
  const r = await reserve(request)
  const res = await request.get(`/api/v1/photos/${r.photo_id}`)
  expect(res.status()).toBe(401)
})

// ── Sweep ─────────────────────────────────────────────────────────────────────

test('the sweep removes stale reservations and leaves live photos alone', async ({ request }) => {
  const stale = await reserve(request)
  const live = await reserve(request)
  expect((await put(request, live.upload_token, MINIMAL_PNG)).status()).toBe(200)

  // Past the one-hour grace period.
  await updatePhotoAdmin(stale.photo_id, {
    upload_expires_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  })

  const secret = process.env.CRON_SECRET
  const sweep = await request.get('/api/cron/sweep-pending-uploads', {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
  expect(sweep.status()).toBe(200)
  expect((await sweep.json()).swept).toBeGreaterThan(0)

  expect(await getPhotoRowAdmin(stale.photo_id)).toBeNull()

  // The live photo is untouched — the assertion the sweep exists to not violate.
  const survivor = await getPhotoRowAdmin(live.photo_id)
  expect(survivor).toBeTruthy()
  expect(survivor!.status).toBe('live')
})

test('a reservation inside the grace period is not swept', async ({ request }) => {
  const recent = await reserve(request)
  // Expired, but only just — an upload could still be in flight.
  await updatePhotoAdmin(recent.photo_id, {
    upload_expires_at: new Date(Date.now() - 60_000).toISOString(),
  })

  const secret = process.env.CRON_SECRET
  const sweep = await request.get('/api/cron/sweep-pending-uploads', {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
  expect(sweep.status()).toBe(200)

  expect(await getPhotoRowAdmin(recent.photo_id)).toBeTruthy()
})
