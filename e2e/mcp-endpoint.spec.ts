/**
 * Remote MCP endpoint tests — /api/mcp.
 *
 * The endpoint runs on mcp-handler (MCP SDK v2) over Streamable HTTP. Two
 * consequences for these tests:
 *
 *   1. Clients MUST accept both application/json and text/event-stream, per the
 *      Streamable HTTP spec. Anything else gets 406. All requests here send the
 *      compliant Accept header; one test pins the 406 behaviour deliberately.
 *   2. Successful responses come back SSE-framed (`event: message\ndata: {...}`),
 *      so bodies go through parseRpc() rather than response.json().
 *
 * Coverage:
 * - Auth enforcement, including the RFC 9728 WWW-Authenticate challenge that
 *   lets an MCP client discover where to get a token
 * - MCP protocol basics: initialize, ping, tools/list
 * - Remote destructive-tool guards (no `force` on delete_object)
 * - Tool annotations
 *
 * Per-tool behaviour lives in __tests__/mcp/server.test.ts.
 */

import { test, expect, type APIResponse, type APIRequestContext } from '@playwright/test'

const MCP_URL = 'http://localhost:3000/api/mcp'
const VALID_KEY = process.env.RINGMARK_API_KEY ?? ''

function mcpHeaders(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Required by Streamable HTTP — omitting either type yields 406
    Accept: 'application/json, text/event-stream',
  }
}

function rpc(method: string, params?: unknown, id: number | null = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
}

/** Reads a JSON-RPC payload from either an SSE frame or a plain JSON body. */
async function parseRpc(r: APIResponse) {
  const text = await r.text()
  const line = text.split('\n').find(l => l.startsWith('data: '))
  return JSON.parse(line ? line.slice('data: '.length) : text)
}

async function toolsList(request: APIRequestContext) {
  const r = await request.post(MCP_URL, { headers: mcpHeaders(VALID_KEY), data: rpc('tools/list') })
  expect(r.status()).toBe(200)
  const body = await parseRpc(r)
  return body.result.tools as Array<{
    name: string
    inputSchema?: { properties?: Record<string, unknown> }
    annotations?: Record<string, boolean>
  }>
}

// ── Auth ──────────────────────────────────────────────────────────────────────

test('GET /api/mcp — unauthenticated health check describes the endpoint', async ({ request }) => {
  const r = await request.get(MCP_URL)
  expect(r.status()).toBe(200)
  const body = await r.json()
  expect(body.service).toBe('Ringmark MCP')
  expect(body.transport).toBe('streamable-http')
  expect(body).toHaveProperty('keysUrl')
  expect(body).toHaveProperty('resourceMetadata')
  // The old shared-secret scheme is gone
  expect(JSON.stringify(body)).not.toContain('MCP_SECRET')
})

test('POST without Authorization → 401', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(401)
  const body = await parseRpc(r)
  expect(body.error?.code).toBe(-32001)
})

test('POST with wrong key → 401', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders('totally-wrong-key-xyz'),
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(401)
  const body = await parseRpc(r)
  expect(body.error?.code).toBe(-32001)
})

test('401 carries the RFC 9728 discovery challenge', async ({ request }) => {
  // Without resource_metadata in the challenge an MCP client has no way to find
  // the authorization server, so the OAuth flow can never start.
  const r = await request.post(MCP_URL, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(401)
  const challenge = r.headers()['www-authenticate'] ?? ''
  expect(challenge).toContain('Bearer')
  expect(challenge).toContain('resource_metadata=')
  expect(challenge).toContain('/.well-known/oauth-protected-resource')
})

test('POST with valid API key → initialize succeeds', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'playwright', version: '1.0.0' },
    }),
  })
  expect(r.status()).toBe(200)
  const body = await parseRpc(r)
  expect(body.result?.serverInfo?.name).toBe('ringmark')
  expect(body.result?.capabilities).toHaveProperty('tools')
})

test('MCP_SECRET env var value (if set) is not accepted as an API key', async ({ request }) => {
  const mcpSecret = process.env.MCP_SECRET
  if (!mcpSecret || mcpSecret === VALID_KEY) return
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(mcpSecret),
    data: rpc('initialize'),
  })
  expect(r.status()).toBe(401)
})

// ── Transport ─────────────────────────────────────────────────────────────────

test('client that does not accept text/event-stream → 406', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: {
      Authorization: `Bearer ${VALID_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    data: rpc('ping'),
  })
  expect(r.status()).toBe(406)
})

test('ping returns empty result', async ({ request }) => {
  const r = await request.post(MCP_URL, { headers: mcpHeaders(VALID_KEY), data: rpc('ping') })
  expect(r.status()).toBe(200)
  const body = await parseRpc(r)
  expect(body.result).toEqual({})
})

test('unknown method returns -32601 method not found', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: rpc('not/a/method'),
  })
  const body = await parseRpc(r)
  expect(body.error?.code).toBe(-32601)
})

test('empty body → parse error -32700', async ({ request }) => {
  const r = await request.post(MCP_URL, {
    headers: mcpHeaders(VALID_KEY),
    data: Buffer.from(''),
  })
  const body = await parseRpc(r)
  expect(body.error?.code).toBe(-32700)
})

// ── Tool surface ──────────────────────────────────────────────────────────────

test('tools/list returns the full ringmark tool set', async ({ request }) => {
  const names = (await toolsList(request)).map(t => t.name)
  expect(names).toContain('list_objects')
  expect(names).toContain('get_object')
  expect(names).toContain('create_object')
  expect(names).toContain('update_object')
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
  const del = (await toolsList(request)).find(t => t.name === 'delete_object')
  expect(del, 'delete_object should be registered').toBeTruthy()
  const props = del?.inputSchema?.properties ?? {}
  expect(Object.keys(props)).toContain('id')
  expect(Object.keys(props)).not.toContain('force')
})

test('read-only tools carry readOnlyHint, delete tools carry destructiveHint', async ({ request }) => {
  const byName = new Map((await toolsList(request)).map(t => [t.name, t]))

  for (const name of ['list_objects', 'search_objects', 'get_object', 'get_lineage', 'list_photos']) {
    expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true)
  }
  for (const name of ['delete_object', 'delete_photo']) {
    expect(byName.get(name)?.annotations?.destructiveHint, name).toBe(true)
    expect(byName.get(name)?.annotations?.readOnlyHint, name).not.toBe(true)
  }
})
