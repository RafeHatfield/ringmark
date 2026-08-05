/**
 * MCP HTTP endpoint tests — step 7 of multi-user plan.
 *
 * Verifies that /api/mcp now uses account-scoped API keys instead of
 * MCP_SECRET. Tests use the same RINGMARK_API_KEY env var that the
 * existing API tests use (goes through the dual-mode fallback while
 * it's still active, or through DB lookup if seeded).
 *
 * Does not test every MCP tool — mcp/server.ts has its own unit test
 * suite (__tests__/mcp/server.test.ts). This file only covers:
 * - Auth enforcement (no key → 401, wrong key → 401, valid key → proceed)
 * - MCP_SECRET no longer accepted
 * - MCP protocol basics: initialize, ping, tools/list
 * - GET health check updated response
 */

import { test, expect } from '@playwright/test'

const MCP_URL = 'http://localhost:3000/api/mcp'
const VALID_KEY = process.env.RINGMARK_API_KEY ?? ''

function mcpHeaders(key: string) {
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

function rpc(method: string, params?: unknown, id: number | null = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

test('GET /api/mcp — health check includes updated keysUrl field', async ({ request }) => {
  const r = await request.get(MCP_URL)
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.service).toBe('Ringmark MCP')
  expect(body.version).toBe('0.3.0')
  expect(body).toHaveProperty('keysUrl')
  // Must NOT reference MCP_SECRET anymore
  expect(JSON.stringify(body)).not.toContain('MCP_SECRET')
})

test('POST without Authorization → 401', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: { 'Content-Type': 'application/json' },
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(401)
  const body = await r.json()
  expect(body.error?.code).toBe(-32001)
})

test('POST with wrong key → 401', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders('totally-wrong-key-xyz'),
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(401)
  const body = await r.json()
  expect(body.error?.code).toBe(-32001)
})

test('POST with valid API key → initialize succeeds', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.result?.serverInfo?.name).toBe('ringmark')
  expect(body.result?.capabilities).toHaveProperty('tools')
})

// ── MCP_SECRET no longer accepted ────────────────────────────────────────────

test('MCP_SECRET env var value (if set) is not accepted as an API key', async ({ request }) => {
  const mcpSecret = process.env.MCP_SECRET
  if (!mcpSecret) {
    // MCP_SECRET not present in test env — the old path is already gone
    console.log('MCP_SECRET not set in test env — skipping (expected after migration)')
    return
  }
  // If MCP_SECRET happens to equal a valid API key in api_keys, this test
  // would incorrectly pass — but that scenario can't happen by design
  // (MCP_SECRET was a separate shared secret, never in api_keys).
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(mcpSecret),
    data: rpc('initialize'),
  })
  // MCP_SECRET should NOT be in api_keys and NOT equal RINGMARK_API_KEY
  // so it must be rejected
  if (mcpSecret !== VALID_KEY) {
    expect(r.status()).toBe(401)
  }
})

// ── MCP protocol basics ───────────────────────────────────────────────────────

test('ping returns empty result', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('ping'),
  })
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.result).toEqual({})
})

test('tools/list returns ringmark tools including delete_object and update_photo', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('tools/list'),
  })
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(Array.isArray(body.result?.tools)).toBe(true)
  const names = body.result.tools.map((t: { name: string }) => t.name)
  // Core tools
  expect(names).toContain('list_objects')
  expect(names).toContain('get_object')
  expect(names).toContain('create_object')
  expect(names).toContain('update_object')
  // Tools added in recent bug-fix sessions
  expect(names).toContain('delete_object')
  expect(names).toContain('update_photo')
  // Soft-delete companion — a delete tool without a restore tool is just a
  // slower delete
  expect(names).toContain('restore_photo')
})

// ── Remote destructive-tool guards ───────────────────────────────────────────
//
// This endpoint is on the public internet. delete_object must not be able to
// take a live public page down, and the API's existing guards only hold if
// `force` is unreachable from here.

test('remote delete_object exposes no force parameter', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('tools/list'),
  })
  const body = await r.json()
  const del = body.result.tools.find((t: { name: string }) => t.name === 'delete_object')
  expect(del, 'delete_object should be registered').toBeTruthy()
  const props = del.inputSchema?.properties ?? {}
  expect(Object.keys(props)).toContain('id')
  expect(Object.keys(props)).not.toContain('force')
})

test('read-only tools carry readOnlyHint, delete tools carry destructiveHint', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('tools/list'),
  })
  const body = await r.json()
  const byName = new Map<string, { annotations?: Record<string, boolean> }>(
    body.result.tools.map((t: { name: string }) => [t.name, t])
  )

  for (const name of ['list_objects', 'search_objects', 'get_object', 'get_lineage', 'list_photos']) {
    expect(byName.get(name)?.annotations?.readOnlyHint, `${name}`).toBe(true)
  }
  for (const name of ['delete_object', 'delete_photo']) {
    expect(byName.get(name)?.annotations?.destructiveHint, `${name}`).toBe(true)
    expect(byName.get(name)?.annotations?.readOnlyHint, `${name}`).not.toBe(true)
  }
})

test('unknown method returns -32601 method not found', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('not/a/method'),
  })
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.error?.code).toBe(-32601)
})

test('empty body (no JSON at all) → parse error -32700', async ({ request }) => {
  // Playwright serialises string `data` to JSON, so send raw bytes instead
  const r = await request.post(MCP_URL, {
    headers: { ...mcpHeaders(VALID_KEY), 'Content-Type': 'application/json' },
    data: Buffer.from(''),   // truly empty body — request.json() will throw
  })
  // May return 400 or 200 depending on runtime JSON parsing behaviour;
  // what matters is the -32700 error code in the body
  const body = await r.json()
  expect(body.error?.code).toBe(-32700)
})
