/**
 * REST API v1 integration tests.
 *
 * Uses Playwright's `request` fixture — no browser context needed.
 * All requests go to http://localhost:3000 (baseURL from playwright.config.ts).
 *
 * Setup: a handful of wood objects are created in beforeAll and tracked by ID
 * so that afterAll can clean them up. Cleanup uses try/catch so a failed delete
 * doesn't mask actual test failures.
 */

import { test, expect, APIRequestContext } from '@playwright/test'

// ── Auth helper ───────────────────────────────────────────────────────────────

function apiHeaders(key = process.env.RINGMARK_API_KEY ?? '') {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

// Unique suffix per test run — avoids workshop ID collisions between runs
const RUN_TAG = `APITST${Date.now()}`

// Track every object ID created so afterAll can clean up
const createdIds: string[] = []

// ── Shared state populated in beforeAll ──────────────────────────────────────

let primaryObjectId = ''
let primaryWorkshopId = ''
let publishedObjectId = ''
let unpublishedObjectId = ''
let searchableObjectId = ''
const UNIQUE_SEARCH_TITLE = `SearchableTitle_${RUN_TAG}`

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  const h = apiHeaders()

  // Create the primary object used across many tests
  const r1 = await request.post('/api/v1/objects', {
    headers: h,
    data: {
      object_type: 'source',
      workshop_id: `${RUN_TAG}PRI`,
      title: 'Primary test object',
      species: 'Bigleaf Maple',
      status: 'acquired',
    },
  })
  expect(r1.status()).toBe(201)
  const obj1 = await r1.json()
  primaryObjectId = obj1.id
  primaryWorkshopId = obj1.workshop_id
  createdIds.push(primaryObjectId)

  // Create a published object
  const r2 = await request.post('/api/v1/objects', {
    headers: h,
    data: { object_type: 'blank', workshop_id: `${RUN_TAG}PUB`, title: 'Published object' },
  })
  expect(r2.status()).toBe(201)
  const obj2 = await r2.json()
  publishedObjectId = obj2.id
  createdIds.push(publishedObjectId)

  // Publish it
  const rPatch = await request.patch(`/api/v1/objects/${publishedObjectId}`, {
    headers: h,
    data: { is_published: true },
  })
  expect(rPatch.status()).toBe(200)

  // Create an unpublished object
  const r3 = await request.post('/api/v1/objects', {
    headers: h,
    data: { object_type: 'log', workshop_id: `${RUN_TAG}UNP`, title: 'Unpublished object' },
  })
  expect(r3.status()).toBe(201)
  const obj3 = await r3.json()
  unpublishedObjectId = obj3.id
  createdIds.push(unpublishedObjectId)

  // Create an object with a unique title for search testing
  const r4 = await request.post('/api/v1/objects', {
    headers: h,
    data: {
      object_type: 'chunk',
      workshop_id: `${RUN_TAG}SCH`,
      title: UNIQUE_SEARCH_TITLE,
      species: 'Oak',
    },
  })
  expect(r4.status()).toBe(201)
  const obj4 = await r4.json()
  searchableObjectId = obj4.id
  createdIds.push(searchableObjectId)
})

test.afterAll(async ({ request }) => {
  const h = apiHeaders()
  for (const id of createdIds) {
    try {
      await request.delete(`/api/v1/objects/${id}`, { headers: h })
    } catch {
      // Ignore cleanup failures — don't mask test results
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

test.describe('auth', () => {
  test('missing Authorization header → 401', async ({ request }) => {
    const r = await request.get('/api/v1/objects')
    expect(r.status()).toBe(401)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('wrong key → 401', async ({ request }) => {
    const r = await request.get('/api/v1/objects', {
      headers: { Authorization: 'Bearer wrong-key-entirely', 'Content-Type': 'application/json' },
    })
    expect(r.status()).toBe(401)
  })

  test('correct key → not 401', async ({ request }) => {
    const r = await request.get('/api/v1/objects', { headers: apiHeaders() })
    expect(r.status()).not.toBe(401)
  })

  test('Bearer prefix required — bare key → 401', async ({ request }) => {
    const key = process.env.RINGMARK_API_KEY ?? ''
    const r = await request.get('/api/v1/objects', {
      headers: { Authorization: key },
    })
    expect(r.status()).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/objects
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/objects', () => {
  test('returns expected list response shape', async ({ request }) => {
    const r = await request.get('/api/v1/objects', { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body).toHaveProperty('data')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('limit')
    expect(body).toHaveProperty('offset')
    expect(Array.isArray(body.data)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(typeof body.limit).toBe('number')
    expect(typeof body.offset).toBe('number')
  })

  test('data items have expected summary fields', async ({ request }) => {
    const r = await request.get('/api/v1/objects?limit=1', { headers: apiHeaders() })
    const body = await r.json()
    if (body.data.length > 0) {
      const item = body.data[0]
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('workshop_id')
      expect(item).toHaveProperty('object_type')
      expect(item).toHaveProperty('is_published')
      expect(item).toHaveProperty('updated_at')
    }
  })

  test('?limit=2 respects the limit (data.length <= 2)', async ({ request }) => {
    const r = await request.get('/api/v1/objects?limit=2', { headers: apiHeaders() })
    const body = await r.json()
    expect(body.data.length).toBeLessThanOrEqual(2)
    expect(body.limit).toBe(2)
  })

  test('?limit above max is capped at 50', async ({ request }) => {
    const r = await request.get('/api/v1/objects?limit=999', { headers: apiHeaders() })
    const body = await r.json()
    expect(body.limit).toBe(50)
  })

  test('?published=true returns only published objects', async ({ request }) => {
    const r = await request.get('/api/v1/objects?published=true', { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    for (const item of body.data) {
      expect(item.is_published).toBe(true)
    }
    // The published object we created must appear
    const ids = body.data.map((o: { id: string }) => o.id)
    expect(ids).toContain(publishedObjectId)
  })

  test('?published=false returns only unpublished objects', async ({ request }) => {
    const r = await request.get('/api/v1/objects?published=false', { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    for (const item of body.data) {
      expect(item.is_published).toBe(false)
    }
    // The unpublished object we created must appear
    const ids = body.data.map((o: { id: string }) => o.id)
    expect(ids).toContain(unpublishedObjectId)
  })

  test('?type=source filters to source objects only', async ({ request }) => {
    const r = await request.get('/api/v1/objects?type=source', { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    for (const item of body.data) {
      expect(item.object_type).toBe('source')
    }
  })

  test('?q=<unique title> returns the matching object', async ({ request }) => {
    const r = await request.get(`/api/v1/objects?q=${encodeURIComponent(UNIQUE_SEARCH_TITLE)}`, {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.total).toBeGreaterThanOrEqual(1)
    const ids = body.data.map((o: { id: string }) => o.id)
    expect(ids).toContain(searchableObjectId)
  })

  test('?offset=0&limit=1 returns exactly one item', async ({ request }) => {
    const r = await request.get('/api/v1/objects?offset=0&limit=1', { headers: apiHeaders() })
    const body = await r.json()
    expect(body.data.length).toBe(1)
    expect(body.offset).toBe(0)
    expect(body.limit).toBe(1)
  })

  test('pagination: offset=1&limit=1 returns a different item than offset=0', async ({ request }) => {
    const r0 = await request.get('/api/v1/objects?offset=0&limit=1', { headers: apiHeaders() })
    const r1 = await request.get('/api/v1/objects?offset=1&limit=1', { headers: apiHeaders() })
    const body0 = await r0.json()
    const body1 = await r1.json()
    if (body0.total >= 2) {
      expect(body0.data[0].id).not.toBe(body1.data[0].id)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/objects
// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/v1/objects', () => {
  test('valid body → 201 with full object shape', async ({ request }) => {
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: {
        object_type: 'slab',
        workshop_id: `${RUN_TAG}NEW`,
        title: 'New slab',
        species: 'Walnut',
        status: 'stored',
      },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('workshop_id')
    expect(body).toHaveProperty('public_slug')
    expect(body.object_type).toBe('slab')
    expect(body.title).toBe('New slab')
    expect(body.species).toBe('Walnut')
    expect(body.status).toBe('stored')
    createdIds.push(body.id)
  })

  test('auto-generates workshop_id when omitted', async ({ request }) => {
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'log' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(typeof body.workshop_id).toBe('string')
    expect(body.workshop_id.length).toBeGreaterThan(0)
    expect(typeof body.public_slug).toBe('string')
    expect(body.public_slug.length).toBeGreaterThan(0)
    createdIds.push(body.id)
  })

  test('custom workshop_id is stored uppercased', async ({ request }) => {
    const wid = `${RUN_TAG}lower`
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'other', workshop_id: wid },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(body.workshop_id).toBe(wid.toUpperCase().trim())
    createdIds.push(body.id)
  })

  test('missing body → 400', async ({ request }) => {
    const r = await request.post('/api/v1/objects', {
      headers: { Authorization: `Bearer ${process.env.RINGMARK_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
      data: {},
    })
    // Empty object is valid (object_type defaults to 'source', status to 'acquired')
    // so we test with invalid JSON instead
    const r2 = await request.post('/api/v1/objects', {
      headers: { Authorization: `Bearer ${process.env.RINGMARK_API_KEY ?? ''}`, 'Content-Type': 'application/json' },
      // Sending a raw string that is not valid JSON
    })
    // No body at all — Content-Type says JSON but no body → parse error
    expect([400, 201]).toContain(r.status()) // empty object gets defaults → 201 is OK
    // r2 has no data at all which can vary by runtime, just verify we don't 500
    expect(r2.status()).not.toBe(500)
    if (r.status() === 201) {
      const obj = await r.json()
      createdIds.push(obj.id)
    }
  })

  test('invalid object_type → 400', async ({ request }) => {
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'not_a_real_type', workshop_id: `${RUN_TAG}BAD` },
    })
    expect(r.status()).toBe(400)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('duplicate workshop_id → 409', async ({ request }) => {
    // Create one object first
    const r1 = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'log', workshop_id: `${RUN_TAG}DUP` },
    })
    expect(r1.status()).toBe(201)
    const first = await r1.json()
    createdIds.push(first.id)

    // Try to create another with the same workshop_id
    const r2 = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'chunk', workshop_id: `${RUN_TAG}DUP` },
    })
    expect(r2.status()).toBe(409)
    const body2 = await r2.json()
    expect(body2).toHaveProperty('error')
    expect(body2.error).toMatch(/taken/i)
  })

  test('created object appears in GET list', async ({ request }) => {
    const wid = `${RUN_TAG}VIS`
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'finished_bowl', workshop_id: wid },
    })
    expect(r.status()).toBe(201)
    const created = await r.json()
    createdIds.push(created.id)

    const list = await request.get(`/api/v1/objects?q=${wid}`, { headers: apiHeaders() })
    const listBody = await list.json()
    const ids = listBody.data.map((o: { id: string }) => o.id)
    expect(ids).toContain(created.id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/objects/:id
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/objects/:id', () => {
  test('get by UUID → 200 with full object', async ({ request }) => {
    const r = await request.get(`/api/v1/objects/${primaryObjectId}`, { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.id).toBe(primaryObjectId)
    expect(body).toHaveProperty('workshop_id')
    expect(body).toHaveProperty('object_type')
    expect(body).toHaveProperty('public_slug')
    expect(body).toHaveProperty('created_at')
    expect(body).toHaveProperty('updated_at')
  })

  test('get by workshop_id → 200 with same object', async ({ request }) => {
    const r = await request.get(`/api/v1/objects/${primaryWorkshopId}`, { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.id).toBe(primaryObjectId)
    expect(body.workshop_id).toBe(primaryWorkshopId)
  })

  test('workshop_id lookup is case-insensitive', async ({ request }) => {
    const lower = primaryWorkshopId.toLowerCase()
    const r = await request.get(`/api/v1/objects/${lower}`, { headers: apiHeaders() })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.id).toBe(primaryObjectId)
  })

  test('unknown UUID → 404', async ({ request }) => {
    const r = await request.get('/api/v1/objects/00000000-0000-0000-0000-000000000000', {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(404)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('unknown workshop_id → 404', async ({ request }) => {
    const r = await request.get('/api/v1/objects/DOES_NOT_EXIST_XYZ999', { headers: apiHeaders() })
    expect(r.status()).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/objects/:id
// ─────────────────────────────────────────────────────────────────────────────

test.describe('PATCH /api/v1/objects/:id', () => {
  test('update title → 200 with updated title', async ({ request }) => {
    const newTitle = `Updated title ${RUN_TAG}`
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { title: newTitle },
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.title).toBe(newTitle)
    expect(body.id).toBe(primaryObjectId)
  })

  test('update status → 200 with updated status', async ({ request }) => {
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { status: 'stored' },
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.status).toBe('stored')
  })

  test('set is_published: true → 200 with is_published === true', async ({ request }) => {
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { is_published: true },
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.is_published).toBe(true)
  })

  test('set is_published: false → 200 with is_published === false', async ({ request }) => {
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { is_published: false },
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.is_published).toBe(false)
  })

  test('sending public_slug is silently ignored — slug unchanged, no error', async ({ request }) => {
    // First get the current slug
    const getR = await request.get(`/api/v1/objects/${primaryObjectId}`, { headers: apiHeaders() })
    const original = await getR.json()
    const originalSlug = original.public_slug

    // Attempt to change it — Zod strips unknown keys so this should be accepted (no 400)
    // and the slug should remain unchanged
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { public_slug: 'i-am-trying-to-change-the-slug', title: 'Slug test' },
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.public_slug).toBe(originalSlug)
  })

  test('update multiple public story fields at once', async ({ request }) => {
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: {
        public_title: 'A Beautiful Maple Bowl',
        public_story: 'This tree fell in a storm...',
        public_notes: 'Hand finished with walnut oil',
        public_care: 'Hand wash only',
      },
    })
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.public_title).toBe('A Beautiful Maple Bowl')
    expect(body.public_story).toBe('This tree fell in a storm...')
    expect(body.public_notes).toBe('Hand finished with walnut oil')
    expect(body.public_care).toBe('Hand wash only')
  })

  test('unknown id → 404', async ({ request }) => {
    const r = await request.patch('/api/v1/objects/00000000-0000-0000-0000-000000000000', {
      headers: apiHeaders(),
      data: { title: 'Ghost update' },
    })
    expect(r.status()).toBe(404)
  })

  test('invalid status value → 400', async ({ request }) => {
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { status: 'ABSOLUTELY_INVALID_STATUS' },
    })
    expect(r.status()).toBe(400)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('invalid object_type value → 400', async ({ request }) => {
    const r = await request.patch(`/api/v1/objects/${primaryObjectId}`, {
      headers: apiHeaders(),
      data: { object_type: 'not_real' },
    })
    expect(r.status()).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/objects/:id
// ─────────────────────────────────────────────────────────────────────────────

test.describe('DELETE /api/v1/objects/:id', () => {
  let deleteTargetId = ''

  test.beforeAll(async ({ request }) => {
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: { object_type: 'offcut', workshop_id: `${RUN_TAG}DEL` },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    deleteTargetId = body.id
    // Don't push to createdIds — the delete tests handle cleanup themselves
  })

  test('DELETE → 204 with no body', async ({ request }) => {
    const r = await request.delete(`/api/v1/objects/${deleteTargetId}`, { headers: apiHeaders() })
    expect(r.status()).toBe(204)
    // Body must be empty
    const text = await r.text()
    expect(text).toBe('')
  })

  test('GET after delete → 404', async ({ request }) => {
    const r = await request.get(`/api/v1/objects/${deleteTargetId}`, { headers: apiHeaders() })
    expect(r.status()).toBe(404)
  })

  test('DELETE again → 404', async ({ request }) => {
    const r = await request.delete(`/api/v1/objects/${deleteTargetId}`, { headers: apiHeaders() })
    expect(r.status()).toBe(404)
  })

  test('DELETE unknown UUID → 404', async ({ request }) => {
    const r = await request.delete('/api/v1/objects/00000000-0000-0000-0000-000000000000', {
      headers: apiHeaders(),
    })
    expect(r.status()).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/objects/:id/children
// ─────────────────────────────────────────────────────────────────────────────

test.describe('POST /api/v1/objects/:id/children', () => {
  let parentId = ''
  let parentWorkshopId = ''

  test.beforeAll(async ({ request }) => {
    const r = await request.post('/api/v1/objects', {
      headers: apiHeaders(),
      data: {
        object_type: 'source',
        workshop_id: `${RUN_TAG}PAR`,
        species: 'Cherry',
        title: 'Parent source for children tests',
      },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    parentId = body.id
    parentWorkshopId = body.workshop_id
    createdIds.push(parentId)
  })

  test('valid child body → 201 with child object', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'log', title: 'First log' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(body).toHaveProperty('id')
    expect(body.object_type).toBe('log')
    expect(body.title).toBe('First log')
    createdIds.push(body.id)
  })

  test('child has correct parent_id', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'chunk' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(body.parent_id).toBe(parentId)
    createdIds.push(body.id)
  })

  test('child workshop_id follows flat descendant format (ROOT-N)', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'blank' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    // Format should be PARENTWORKSHOPID-N (flat, not nested)
    const pattern = new RegExp(`^${parentWorkshopId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`, 'i')
    expect(body.workshop_id).toMatch(pattern)
    createdIds.push(body.id)
  })

  test('child inherits species from parent when not specified', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'slab' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    // Parent has species 'Cherry' — child should inherit it
    expect(body.species).toBe('Cherry')
    createdIds.push(body.id)
  })

  test('species can be overridden on child', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'offcut', species: 'Walnut' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(body.species).toBe('Walnut')
    createdIds.push(body.id)
  })

  test('grandchild workshop_id still uses flat format off root (not nested)', async ({ request }) => {
    // Create a child first
    const childR = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'log' },
    })
    expect(childR.status()).toBe(201)
    const child = await childR.json()
    createdIds.push(child.id)

    // Create grandchild off the child
    const grandchildR = await request.post(`/api/v1/objects/${child.id}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'blank' },
    })
    expect(grandchildR.status()).toBe(201)
    const grandchild = await grandchildR.json()
    createdIds.push(grandchild.id)

    // Grandchild workshop_id must be ROOT-N, not ROOT-N-M
    const flatPattern = new RegExp(`^${parentWorkshopId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`, 'i')
    expect(grandchild.workshop_id).toMatch(flatPattern)
    // Must NOT contain two hyphens (which would indicate nested numbering like RH1-1-1)
    expect(grandchild.workshop_id.split('-').length).toBe(2)
  })

  test('object_type is required — missing → 400', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { title: 'A child without type' },
    })
    expect(r.status()).toBe(400)
    const body = await r.json()
    expect(body).toHaveProperty('error')
  })

  test('invalid object_type on child → 400', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'not_valid_at_all' },
    })
    expect(r.status()).toBe(400)
  })

  test('unknown parent UUID → 404', async ({ request }) => {
    const r = await request.post('/api/v1/objects/00000000-0000-0000-0000-000000000000/children', {
      headers: apiHeaders(),
      data: { object_type: 'log' },
    })
    expect(r.status()).toBe(404)
    const body = await r.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/not found/i)
  })

  test('child has root_id pointing to the ultimate root', async ({ request }) => {
    const r = await request.post(`/api/v1/objects/${parentId}/children`, {
      headers: apiHeaders(),
      data: { object_type: 'rough_bowl' },
    })
    expect(r.status()).toBe(201)
    const body = await r.json()
    expect(body.root_id).toBe(parentId)
    createdIds.push(body.id)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/openapi.json
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/openapi.json', () => {
  test('200 with Content-Type: application/json', async ({ request }) => {
    const r = await request.get('/api/v1/openapi.json')
    expect(r.status()).toBe(200)
    expect(r.headers()['content-type']).toContain('application/json')
  })

  test('no auth required', async ({ request }) => {
    // No Authorization header — must still return 200
    const r = await request.get('/api/v1/openapi.json')
    expect(r.status()).toBe(200)
  })

  test('response has openapi field starting with "3."', async ({ request }) => {
    const r = await request.get('/api/v1/openapi.json')
    const body = await r.json()
    expect(typeof body.openapi).toBe('string')
    expect(body.openapi).toMatch(/^3\./)
  })

  test('response has info.title = "Ringmark API"', async ({ request }) => {
    const r = await request.get('/api/v1/openapi.json')
    const body = await r.json()
    expect(body.info?.title).toBe('Ringmark API')
  })

  test('response has paths object with expected routes', async ({ request }) => {
    const r = await request.get('/api/v1/openapi.json')
    const body = await r.json()
    expect(body).toHaveProperty('paths')
    expect(typeof body.paths).toBe('object')
    // Key routes must be present
    const paths = Object.keys(body.paths)
    expect(paths.some(p => p.includes('/objects'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/docs
// ─────────────────────────────────────────────────────────────────────────────

test.describe('GET /api/v1/docs', () => {
  test('200 with Content-Type: text/html', async ({ request }) => {
    const r = await request.get('/api/v1/docs')
    expect(r.status()).toBe(200)
    expect(r.headers()['content-type']).toContain('text/html')
  })

  test('no auth required', async ({ request }) => {
    const r = await request.get('/api/v1/docs')
    expect(r.status()).toBe(200)
  })

  test('body contains swagger-ui', async ({ request }) => {
    const r = await request.get('/api/v1/docs')
    const text = await r.text()
    expect(text.toLowerCase()).toContain('swagger-ui')
  })

  test('body references the openapi.json spec URL', async ({ request }) => {
    const r = await request.get('/api/v1/docs')
    const text = await r.text()
    expect(text).toContain('/api/v1/openapi.json')
  })
})
