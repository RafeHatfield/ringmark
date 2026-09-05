/**
 * MCP server tests.
 *
 * Uses InMemoryTransport from the MCP SDK to wire a client and server together
 * in-process — no stdio, no Claude Desktop, no running API server required.
 *
 * Three categories:
 *   1. Manifest — tools/list returns the complete expected set
 *   2. Non-JSON guard — HTML responses produce a structured error, not a parse crash
 *   3. Timeout — stalled fetch aborts and surfaces a readable error
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, chmodSync } from 'fs'
import os from 'node:os'
import path from 'node:path'
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from '../../mcp/server.js'

const TEST_KEY = 'test-api-key'
const TEST_BASE = 'http://test.local/api/v1'

const EXPECTED_TOOLS = [
  'add_child',
  'add_market_items',
  'confirm_upload',
  'create_market_event',
  'create_object',
  'create_upload_url',
  'delete_market_event',
  'delete_object',
  'delete_photo',
  'get_lineage',
  'get_market_event',
  'get_object',
  'list_market_events',
  'list_objects',
  'list_photos',
  'mark_item_sold',
  'publish_object',
  'remove_market_item',
  'restore_photo',
  'save_story',
  'search_objects',
  'unmark_item_sold',
  'update_market_event',
  'update_market_item_price',
  'update_object',
  'update_photo',
  'upload_photo',
].sort()

// ── Helpers ───────────────────────────────────────────────────────────────────

type Pair = { client: Client; cleanup: () => Promise<void> }

/**
 * Default options match the REMOTE server (app/api/mcp/route.ts): no
 * allowForceDelete. Pass { allowForceDelete: true } to get the local stdio
 * shape.
 */
async function connectPair(
  timeoutMs = 30_000,
  options: { hosted?: boolean; allowForceDelete?: boolean } = {},
): Promise<Pair> {
  const server = createServer(TEST_KEY, TEST_BASE, timeoutMs, options)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, cleanup: () => client.close() }
}

function mockFetch(response: Response) {
  const original = global.fetch
  global.fetch = async () => response
  return () => { global.fetch = original }
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return ((result.content as Array<{ text?: string }>)[0]?.text) ?? ''
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ringmark MCP server — manifest', () => {
  it('tools/list returns all 27 expected tools', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      assert.deepEqual(tools.map(t => t.name).sort(), EXPECTED_TOOLS)
    } finally {
      await cleanup()
    }
  })

  it('every tool has a non-empty description', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      for (const tool of tools) {
        assert.ok(tool.description?.length, `${tool.name} is missing a description`)
      }
    } finally {
      await cleanup()
    }
  })

  it('update_object description directs to save_story for public_* fields', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      const updateObj = tools.find(t => t.name === 'update_object')
      assert.ok(updateObj, 'update_object tool not found')
      const desc = updateObj.description ?? ''
      assert.ok(
        desc.includes('save_story'),
        `update_object description should mention save_story for public_* fields, got: ${desc}`
      )
    } finally {
      await cleanup()
    }
  })

  it('get_object requires an id parameter', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      const getObj = tools.find(t => t.name === 'get_object')
      assert.ok(getObj, 'get_object tool not found')
      const props = (getObj.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      assert.ok('id' in props, 'get_object must declare an id parameter')
    } finally {
      await cleanup()
    }
  })
})

describe('ringmark MCP server — tool annotations', () => {
  const READ_ONLY = [
    'list_objects', 'search_objects', 'get_object', 'get_lineage', 'list_photos',
    'list_market_events', 'get_market_event',
  ]
  const IDEMPOTENT = [
    'update_object', 'update_photo', 'save_story', 'restore_photo', 'publish_object',
    'update_market_event', 'update_market_item_price', 'mark_item_sold', 'unmark_item_sold',
  ]
  const DESTRUCTIVE = ['delete_object', 'delete_photo', 'delete_market_event', 'remove_market_item']

  it('read-only tools are annotated readOnlyHint', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      for (const name of READ_ONLY) {
        const tool = tools.find(t => t.name === name)
        assert.ok(tool, `${name} not found`)
        assert.equal(tool.annotations?.readOnlyHint, true, `${name} should be readOnlyHint`)
      }
    } finally {
      await cleanup()
    }
  })

  it('mutating tools are NOT annotated readOnlyHint', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      for (const name of [
        ...IDEMPOTENT, ...DESTRUCTIVE,
        'create_object', 'add_child', 'upload_photo',
        'create_market_event', 'add_market_items',
      ]) {
        const tool = tools.find(t => t.name === name)
        assert.ok(tool, `${name} not found`)
        assert.notEqual(
          tool.annotations?.readOnlyHint, true,
          `${name} mutates state and must not claim readOnlyHint`
        )
      }
    } finally {
      await cleanup()
    }
  })

  it('idempotent tools are annotated idempotentHint', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      for (const name of IDEMPOTENT) {
        const tool = tools.find(t => t.name === name)
        assert.ok(tool, `${name} not found`)
        assert.equal(tool.annotations?.idempotentHint, true, `${name} should be idempotentHint`)
      }
    } finally {
      await cleanup()
    }
  })

  it('delete tools are annotated destructiveHint', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      for (const name of DESTRUCTIVE) {
        const tool = tools.find(t => t.name === name)
        assert.ok(tool, `${name} not found`)
        assert.equal(tool.annotations?.destructiveHint, true, `${name} should be destructiveHint`)
      }
    } finally {
      await cleanup()
    }
  })

  it('only upload_photo reaches outside Ringmark (openWorldHint)', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      for (const tool of tools) {
        const expected = tool.name === 'upload_photo'
        assert.equal(
          tool.annotations?.openWorldHint, expected,
          `${tool.name} openWorldHint should be ${expected}`
        )
      }
    } finally {
      await cleanup()
    }
  })
})

describe('ringmark MCP server — delete_object force gating', () => {
  it('remote shape (default) exposes no force parameter', async () => {
    const { client, cleanup } = await connectPair()
    try {
      const { tools } = await client.listTools()
      const del = tools.find(t => t.name === 'delete_object')
      assert.ok(del, 'delete_object not found')
      const props = (del.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      assert.ok(!('force' in props), 'remote delete_object must not expose force')
      assert.ok('id' in props, 'delete_object must still take an id')
    } finally {
      await cleanup()
    }
  })

  it('remote shape never sends ?force=true, even if force is passed anyway', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return new Response(null, { status: 204 })
    }
    const { client, cleanup } = await connectPair()
    try {
      // An unknown extra arg must not become a force delete
      await client.callTool({ name: 'delete_object', arguments: { id: 'RH4', force: true } })
      assert.ok(!capturedUrl.includes('force'), `remote delete must not force, got: ${capturedUrl}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('local shape exposes force and sends ?force=true when set', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return new Response(null, { status: 204 })
    }
    const { client, cleanup } = await connectPair(30_000, { allowForceDelete: true })
    try {
      const { tools } = await client.listTools()
      const del = tools.find(t => t.name === 'delete_object')
      const props = (del?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      assert.ok('force' in props, 'local delete_object should expose force')

      await client.callTool({ name: 'delete_object', arguments: { id: 'RH4', force: true } })
      assert.ok(capturedUrl.includes('force=true'), `expected force=true, got: ${capturedUrl}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })
})

describe('ringmark MCP server — non-JSON guard', () => {
  it('HTML response produces a structured error with HTTP status, not a parse crash', async () => {
    const restore = mockFetch(
      new Response('<!DOCTYPE html><html><body>Not Found</body></html>', {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'list_objects', arguments: {} })
      const text = textOf(result)
      assert.ok(result.isError, 'expected isError: true for an HTML response')
      assert.ok(text.includes('404'), `error should mention HTTP status, got: ${text}`)
      assert.ok(text.includes('non-JSON'), `error should mention non-JSON, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('500 HTML error page surfaces status in the error message', async () => {
    const restore = mockFetch(
      new Response('<!DOCTYPE html>Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'search_objects', arguments: { query: 'maple' } })
      const text = textOf(result)
      assert.ok(result.isError, 'expected isError: true for a 500 HTML response')
      assert.ok(text.includes('500'), `error should mention HTTP 500, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('401 JSON error from API propagates cleanly', async () => {
    const restore = mockFetch(
      Response.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'list_objects', arguments: {} })
      const text = textOf(result)
      assert.ok(result.isError, 'expected isError: true for a 401')
      assert.ok(text.includes('Unauthorized'), `expected Unauthorized in error, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — timeout', () => {
  it('stalled fetch aborts and returns a timeout error within the configured window', { timeout: 5000 }, async () => {
    // Fetch that hangs but respects AbortSignal — required so our AbortController can actually cancel it.
    // A bare `new Promise(() => {})` ignores the signal, causing the handler to hang forever.
    const original = global.fetch
    global.fetch = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError'))
        )
      })

    const { client, cleanup } = await connectPair(150)
    try {
      const result = await client.callTool({ name: 'get_object', arguments: { id: 'RH1' } })
      const text = textOf(result)
      assert.ok(result.isError, 'expected isError: true for a timed-out request')
      assert.ok(text.toLowerCase().includes('timed'), `expected timed out in error, got: ${text}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })
})

describe('ringmark MCP server — get_object behaviour', () => {
  it('returns a not-found message (no error) when the API returns 404', async () => {
    const restore = mockFetch(
      Response.json({ error: 'Object not found' }, { status: 404 })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'get_object', arguments: { id: 'DOES-NOT-EXIST' } })
      const text = textOf(result)
      assert.ok(!result.isError, 'get_object should NOT set isError for a not-found ID')
      assert.ok(text.includes('No object found'), `expected not-found message, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('sends the Authorization header on every request', async () => {
    let capturedAuth = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.['Authorization'] ?? ''
      return Response.json({ id: 'abc', workshop_id: 'RH1' })
    }
    const { client, cleanup } = await connectPair()
    try {
      await client.callTool({ name: 'get_object', arguments: { id: 'RH1' } })
      assert.equal(capturedAuth, `Bearer ${TEST_KEY}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })
})

describe('ringmark MCP server — create_upload_url + confirm_upload', () => {
  const RESERVATION = {
    photo_id: 'photo-ccc',
    upload_url: 'https://ringmark.org/api/upload',
    upload_token: 'tok_abc123',
    expires_at: '2026-09-02T12:15:00.000Z',
    max_bytes: 4_000_000,
    accepted_types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    instructions:
      "curl -sS -X PUT --data-binary @<file> -H 'Content-Type: image/jpeg' " +
      "-H 'Authorization: Bearer tok_abc123' 'https://ringmark.org/api/upload'",
  }

  it('create_upload_url posts to the object\'s upload-url endpoint', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = String(init?.body ?? '')
      return Response.json(RESERVATION, { status: 201 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'create_upload_url',
        arguments: { object_id: 'RH10-2', filename: 'IMG_1719.jpeg', caption: 'Second angle' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(
        capturedUrl.endsWith('/objects/RH10-2/photos/upload-url'),
        `unexpected URL: ${capturedUrl}`,
      )
      assert.equal(JSON.parse(capturedBody).filename, 'IMG_1719.jpeg')
      assert.equal(JSON.parse(capturedBody).caption, 'Second angle')
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('create_upload_url surfaces the curl command the caller has to run', async () => {
    // The whole flow depends on the model actually running the upload step, so
    // the ready-made command must survive into the tool output verbatim.
    const restore = mockFetch(Response.json(RESERVATION, { status: 201 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'create_upload_url',
        arguments: { object_id: 'RH10-2', filename: 'IMG_1719.jpeg' },
      })
      const text = textOf(result)
      assert.ok(text.includes(RESERVATION.instructions), `instructions missing from: ${text}`)
      assert.ok(text.includes('photo-ccc'), `photo id missing from: ${text}`)
      assert.ok(text.includes('4000000'), `max_bytes missing from: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('create_upload_url omits caption when none is given', async () => {
    let capturedBody = ''
    const original = global.fetch
    global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return Response.json(RESERVATION, { status: 201 })
    }
    const { client, cleanup } = await connectPair()
    try {
      await client.callTool({
        name: 'create_upload_url',
        arguments: { object_id: 'RH10-2', filename: 'a.jpg' },
      })
      assert.equal('caption' in JSON.parse(capturedBody), false, capturedBody)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('confirm_upload reports a live photo with its size and URL', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return Response.json({
        id: 'photo-ccc',
        object_id: 'obj-1',
        status: 'live',
        bytes: 481_920,
        sort_order: 1,
        signed_url: 'https://example.test/signed.jpg',
        message: null,
      })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'confirm_upload',
        arguments: { photo_id: 'photo-ccc' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.endsWith('/photos/photo-ccc'), `unexpected URL: ${capturedUrl}`)
      const text = textOf(result)
      assert.ok(text.includes('live'), text)
      assert.ok(text.includes('481920'), text)
      assert.ok(text.includes('https://example.test/signed.jpg'), text)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('confirm_upload passes the server\'s next-step message through for a stale reservation', async () => {
    const restore = mockFetch(
      Response.json({
        id: 'photo-ccc',
        object_id: 'obj-1',
        status: 'pending',
        bytes: null,
        sort_order: 1,
        signed_url: null,
        message: 'The upload reservation expired before any bytes arrived. Call create_upload_url again for a fresh token.',
      })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'confirm_upload',
        arguments: { photo_id: 'photo-ccc' },
      })
      const text = textOf(result)
      assert.ok(text.includes('pending'), text)
      assert.ok(text.includes('create_upload_url again'), text)
      // No signed URL for a photo with no bytes behind it.
      assert.ok(!text.includes('View:'), text)
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — list_photos + delete_photo', () => {
  it('list_photos returns a numbered list with IDs', async () => {
    const restore = mockFetch(
      Response.json({
        data: [
          { id: 'photo-aaa', caption: 'Bark crust', is_public: true, sort_order: 0, signed_url: null },
          { id: 'photo-bbb', caption: null, is_public: true, sort_order: 1, signed_url: null },
        ],
        total: 2,
      })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'list_photos', arguments: { object_id: 'RH4' } })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      const text = textOf(result)
      assert.ok(text.includes('photo-aaa'), `expected photo ID, got: ${text}`)
      assert.ok(text.includes('Bark crust'), `expected caption, got: ${text}`)
      assert.ok(text.includes('2 photo'), `expected count, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('list_photos with no photos returns a clear message', async () => {
    const restore = mockFetch(Response.json({ data: [], total: 0 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'list_photos', arguments: { object_id: 'RH4' } })
      assert.ok(!result.isError)
      assert.ok(textOf(result).includes('No photos'), `expected no-photos message, got: ${textOf(result)}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('delete_photo sends DELETE to the correct URL and reports success', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return new Response(null, { status: 204 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'delete_photo',
        arguments: { object_id: 'RH4', photo_id: 'photo-aaa' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('/objects/RH4/photos/photo-aaa'), `wrong URL: ${capturedUrl}`)
      assert.ok(textOf(result).includes('deleted'), `expected deleted confirmation, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('delete_photo surfaces API error (e.g. photo not found)', async () => {
    const restore = mockFetch(Response.json({ error: 'Photo not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'delete_photo',
        arguments: { object_id: 'RH4', photo_id: '00000000-0000-0000-0000-000000000000' },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 photo')
      assert.ok(textOf(result).includes('Photo not found'), `expected error message, got: ${textOf(result)}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('delete_photo tells the caller the delete is reversible', async () => {
    const original = global.fetch
    global.fetch = async () => new Response(null, { status: 204 })
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'delete_photo',
        arguments: { object_id: 'RH4', photo_id: 'photo-aaa' },
      })
      assert.ok(
        textOf(result).includes('restore_photo'),
        `delete confirmation should point at restore_photo, got: ${textOf(result)}`
      )
    } finally {
      global.fetch = original
      await cleanup()
    }
  })
})

describe('ringmark MCP server — soft delete and restore', () => {
  it('list_photos omits include_deleted from the query by default', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return Response.json({ data: [], total: 0 })
    }
    const { client, cleanup } = await connectPair()
    try {
      await client.callTool({ name: 'list_photos', arguments: { object_id: 'RH4' } })
      assert.ok(!capturedUrl.includes('include_deleted'), `unexpected query: ${capturedUrl}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('list_photos passes include_deleted through and marks deleted rows', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return Response.json({
        data: [
          { id: 'photo-live', caption: 'Keeper', is_public: true, sort_order: 0, signed_url: null, deleted_at: null },
          { id: 'photo-gone', caption: 'Blurry', is_public: true, sort_order: 1, signed_url: null, deleted_at: '2026-08-04T10:00:00Z' },
        ],
        total: 2,
      })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'list_photos',
        arguments: { object_id: 'RH4', include_deleted: true },
      })
      assert.ok(capturedUrl.includes('include_deleted=true'), `expected query param, got: ${capturedUrl}`)
      const text = textOf(result)
      assert.ok(text.includes('photo-gone'), `expected deleted photo listed, got: ${text}`)
      assert.match(text, /photo-gone.*\[deleted\]/, `deleted photo should be marked, got: ${text}`)
      assert.ok(!/photo-live.*\[deleted\]/.test(text), `live photo must not be marked deleted, got: ${text}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('restore_photo POSTs to the restore endpoint and confirms the position', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedMethod = init?.method ?? ''
      return Response.json({ id: 'photo-gone', sort_order: 1 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'restore_photo',
        arguments: { object_id: 'RH4', photo_id: 'photo-gone' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(capturedMethod, 'POST')
      assert.ok(
        capturedUrl.includes('/objects/RH4/photos/photo-gone/restore'),
        `wrong URL: ${capturedUrl}`
      )
      assert.ok(textOf(result).includes('restored'), `expected restore confirmation, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('restore_photo surfaces a 404 when the photo is not deleted', async () => {
    const restore = mockFetch(
      Response.json({ error: 'No deleted photo with that ID on this object' }, { status: 404 })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'restore_photo',
        arguments: { object_id: 'RH4', photo_id: 'photo-live' },
      })
      assert.ok(result.isError, 'expected isError: true for a non-deleted photo')
      assert.ok(
        textOf(result).includes('No deleted photo'),
        `expected not-deleted error, got: ${textOf(result)}`
      )
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — get_lineage', () => {
  it('formats the chain as a readable text list ordered root-first', async () => {
    const restore = mockFetch(
      Response.json({
        steps: [
          { workshop_id: 'RH9', step_label: 'The tree', public_story: 'A lightning bolt hit this oak.', photo_count: 2, thumbnail_url: null },
          { workshop_id: 'RH9-1', step_label: 'Cut into slabs', public_story: 'Extraordinary colour inside.', photo_count: 1, thumbnail_url: null },
          { workshop_id: 'RH9-4', step_label: 'Finished', public_story: null, photo_count: 3, thumbnail_url: null },
        ],
      })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'get_lineage', arguments: { id: 'RH9-4' } })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      const text = textOf(result)
      assert.ok(text.includes('RH9'), `expected RH9 in output, got: ${text}`)
      assert.ok(text.includes('RH9-4'), `expected RH9-4 in output, got: ${text}`)
      assert.ok(text.includes('lightning bolt'), `expected story snippet, got: ${text}`)
      assert.ok(text.includes('2 photos'), `expected photo count, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('returns a not-found error when the object does not exist', async () => {
    const restore = mockFetch(Response.json({ error: 'Object not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'get_lineage', arguments: { id: 'NOPE' } })
      assert.ok(result.isError, 'expected isError: true for a missing object')
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — create_market_event + list_market_events', () => {
  it('create_market_event POSTs the name and reports the new event', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json(
        { id: 'evt-1', name: 'Lynn Valley Farmers Market', status: 'planning' },
        { status: 201 }
      )
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'create_market_event',
        arguments: { name: 'Lynn Valley Farmers Market', event_date: '2026-08-16' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('/market-events'), `wrong URL: ${capturedUrl}`)
      assert.equal(capturedBody.name, 'Lynn Valley Farmers Market')
      assert.equal(capturedBody.event_date, '2026-08-16')
      const text = textOf(result)
      assert.ok(text.includes('evt-1'), `expected event ID, got: ${text}`)
      assert.ok(text.includes('planning'), `expected status, got: ${text}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('create_market_event surfaces an API error', async () => {
    const restore = mockFetch(Response.json({ error: 'Something went wrong' }, { status: 500 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'create_market_event',
        arguments: { name: 'Broken Market' },
      })
      assert.ok(result.isError, 'expected isError: true for a 500 response')
      assert.ok(textOf(result).includes('Something went wrong'), `unexpected message: ${textOf(result)}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('list_market_events passes status through as a query param', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return Response.json({
        data: [{ id: 'evt-1', name: 'Lynn Valley Farmers Market', status: 'active' }],
        total: 1,
      })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'list_market_events', arguments: { status: 'active' } })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('status=active'), `expected status query param, got: ${capturedUrl}`)
      assert.ok(textOf(result).includes('Lynn Valley Farmers Market'), `expected event name, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('list_market_events surfaces an API error', async () => {
    const restore = mockFetch(Response.json({ error: 'Unauthorized' }, { status: 401 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'list_market_events', arguments: {} })
      assert.ok(result.isError, 'expected isError: true for a 401 response')
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — get_market_event', () => {
  it('formats items and totals as readable text, including each item_id', async () => {
    const restore = mockFetch(
      Response.json({
        id: 'evt-1',
        name: 'Lynn Valley Farmers Market',
        status: 'active',
        event_date: '2026-08-16',
        location_text: 'Lynn Valley Village',
        items: [
          { id: 'item-1', workshop_id: 'RH9-4', title: 'Maple Bowl', asking_price_cents: 12000, sold: false, sold_price_cents: null },
          { id: 'item-2', workshop_id: 'RH3', title: null, asking_price_cents: 8000, sold: true, sold_price_cents: 7500 },
        ],
        totals: { item_count: 2, sold_count: 1, total_asking_cents: 20000, total_sold_cents: 7500 },
      })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'get_market_event', arguments: { id: 'evt-1' } })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      const text = textOf(result)
      assert.ok(text.includes('Lynn Valley Farmers Market'), `expected event name, got: ${text}`)
      assert.ok(text.includes('2 item(s), 1 sold'), `expected totals line, got: ${text}`)
      assert.ok(text.includes('$200.00'), `expected asking total, got: ${text}`)
      assert.ok(text.includes('$75.00'), `expected sold total, got: ${text}`)
      assert.ok(text.includes('RH9-4'), `expected item workshop ID, got: ${text}`)
      assert.ok(text.includes('item_id: item-1'), `expected item_id, got: ${text}`)
      assert.ok(text.includes('SOLD'), `expected sold marker, got: ${text}`)
    } finally {
      restore()
      await cleanup()
    }
  })

  it('returns a not-found message (no error) when the event does not exist', async () => {
    const restore = mockFetch(Response.json({ error: 'Market event not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'get_market_event', arguments: { id: 'nope' } })
      assert.ok(!result.isError, 'get_market_event should NOT set isError for a not-found ID')
      assert.ok(textOf(result).includes('No market event found'), `expected not-found message, got: ${textOf(result)}`)
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — update_market_event + delete_market_event', () => {
  it('update_market_event PATCHes only the provided fields', async () => {
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? ''
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({ id: 'evt-1', name: 'Lynn Valley Farmers Market', status: 'active' })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'update_market_event',
        arguments: { id: 'evt-1', status: 'active' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(capturedMethod, 'PATCH')
      assert.deepEqual(capturedBody, { status: 'active' })
      assert.ok(textOf(result).includes('active'), `expected updated status, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('update_market_event surfaces an API error', async () => {
    const restore = mockFetch(Response.json({ error: 'Market event not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'update_market_event',
        arguments: { id: 'nope', name: 'New name' },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 response')
    } finally {
      restore()
      await cleanup()
    }
  })

  it('delete_market_event sends DELETE to the correct URL and reports success', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedMethod = init?.method ?? ''
      return new Response(null, { status: 204 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'delete_market_event', arguments: { id: 'evt-1' } })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(capturedMethod, 'DELETE')
      assert.ok(capturedUrl.includes('/market-events/evt-1'), `wrong URL: ${capturedUrl}`)
      assert.ok(textOf(result).includes('Deleted market event'), `expected confirmation, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('delete_market_event surfaces an API error', async () => {
    const restore = mockFetch(Response.json({ error: 'Market event not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({ name: 'delete_market_event', arguments: { id: 'nope' } })
      assert.ok(result.isError, 'expected isError: true for a 404 response')
      assert.ok(textOf(result).includes('Market event not found'), `expected error message, got: ${textOf(result)}`)
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — add_market_items + remove_market_item', () => {
  it('add_market_items posts object_ids in bulk and reports added/skipped', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({
        added: [{ id: 'item-1', workshop_id: 'RH9-4' }],
        skipped: [{ id: 'RH3', reason: 'Already on this event' }],
      })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'add_market_items',
        arguments: { market_event_id: 'evt-1', object_ids: ['RH9-4', 'RH3'] },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('/market-events/evt-1/items/bulk'), `wrong URL: ${capturedUrl}`)
      assert.deepEqual(capturedBody.object_ids, ['RH9-4', 'RH3'])
      const text = textOf(result)
      assert.ok(text.includes('Added 1 of 2'), `expected added count, got: ${text}`)
      assert.ok(text.includes('RH9-4'), `expected added workshop ID, got: ${text}`)
      assert.ok(text.includes('Already on this event'), `expected skip reason, got: ${text}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('add_market_items surfaces an API error', async () => {
    const restore = mockFetch(Response.json({ error: 'Market event not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'add_market_items',
        arguments: { market_event_id: 'nope', object_ids: ['RH1'] },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 response')
    } finally {
      restore()
      await cleanup()
    }
  })

  it('remove_market_item sends DELETE to the correct URL and reports success', async () => {
    let capturedUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return new Response(null, { status: 204 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'remove_market_item',
        arguments: { market_event_id: 'evt-1', item_id: 'item-1' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('/market-events/evt-1/items/item-1'), `wrong URL: ${capturedUrl}`)
      assert.ok(textOf(result).includes('Removed'), `expected confirmation, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('remove_market_item surfaces an API error (e.g. item not found)', async () => {
    const restore = mockFetch(Response.json({ error: 'Item not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'remove_market_item',
        arguments: { market_event_id: 'evt-1', item_id: 'nope' },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 item')
      assert.ok(textOf(result).includes('Item not found'), `expected error message, got: ${textOf(result)}`)
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — update_market_item_price', () => {
  it('sets a new asking price and reports it formatted as dollars', async () => {
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({ id: 'item-1', workshop_id: 'RH9-4', asking_price_cents: 12000 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'update_market_item_price',
        arguments: { market_event_id: 'evt-1', item_id: 'item-1', asking_price_cents: 12000 },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('/market-events/evt-1/items/item-1'), `wrong URL: ${capturedUrl}`)
      assert.equal(capturedBody.asking_price_cents, 12000)
      assert.ok(textOf(result).includes('$120.00'), `expected formatted price, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('passing null clears the price', async () => {
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({ id: 'item-1', workshop_id: 'RH9-4', asking_price_cents: null })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'update_market_item_price',
        arguments: { market_event_id: 'evt-1', item_id: 'item-1', asking_price_cents: null },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(capturedBody.asking_price_cents, null)
      assert.ok(textOf(result).includes('cleared'), `expected cleared confirmation, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('surfaces an API error (e.g. item not found)', async () => {
    const restore = mockFetch(Response.json({ error: 'Item not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'update_market_item_price',
        arguments: { market_event_id: 'evt-1', item_id: 'nope', asking_price_cents: 5000 },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 item')
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — mark_item_sold + unmark_item_sold', () => {
  it('mark_item_sold posts to mark-sold and reports the object status change', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedMethod = init?.method ?? ''
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({ id: 'item-1', workshop_id: 'RH9-4', sold_price_cents: 15000 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'mark_item_sold',
        arguments: { market_event_id: 'evt-1', item_id: 'item-1', sold_price_cents: 15000 },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(capturedMethod, 'POST')
      assert.ok(capturedUrl.includes('/market-events/evt-1/items/item-1/mark-sold'), `wrong URL: ${capturedUrl}`)
      assert.equal(capturedBody.sold_price_cents, 15000)
      const text = textOf(result)
      assert.ok(text.includes('$150.00'), `expected formatted sold price, got: ${text}`)
      assert.ok(text.includes('status set to sold'), `expected status-change confirmation, got: ${text}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('mark_item_sold omits sold_price_cents from the request when not provided (server defaults to asking price)', async () => {
    let capturedBody: Record<string, unknown> = {}
    const original = global.fetch
    global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'))
      return Response.json({ id: 'item-1', workshop_id: 'RH9-4', sold_price_cents: 12000 })
    }
    const { client, cleanup } = await connectPair()
    try {
      await client.callTool({
        name: 'mark_item_sold',
        arguments: { market_event_id: 'evt-1', item_id: 'item-1' },
      })
      assert.ok(!('sold_price_cents' in capturedBody), `expected no sold_price_cents in body, got: ${JSON.stringify(capturedBody)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('mark_item_sold surfaces an API error (e.g. item not found)', async () => {
    const restore = mockFetch(Response.json({ error: 'Item not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'mark_item_sold',
        arguments: { market_event_id: 'evt-1', item_id: 'nope' },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 item')
    } finally {
      restore()
      await cleanup()
    }
  })

  it('unmark_item_sold posts to unmark-sold and reports the object status reverting', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedMethod = init?.method ?? ''
      return Response.json({ id: 'item-1', workshop_id: 'RH9-4' })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'unmark_item_sold',
        arguments: { market_event_id: 'evt-1', item_id: 'item-1' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(capturedMethod, 'POST')
      assert.ok(capturedUrl.includes('/market-events/evt-1/items/item-1/unmark-sold'), `wrong URL: ${capturedUrl}`)
      assert.ok(textOf(result).includes('reverted to for_sale'), `expected status-revert confirmation, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('unmark_item_sold surfaces an API error (e.g. item not found)', async () => {
    const restore = mockFetch(Response.json({ error: 'Item not found' }, { status: 404 }))
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'unmark_item_sold',
        arguments: { market_event_id: 'evt-1', item_id: 'nope' },
      })
      assert.ok(result.isError, 'expected isError: true for a 404 item')
    } finally {
      restore()
      await cleanup()
    }
  })
})

describe('ringmark MCP server — upload_photo', () => {
  // Minimal valid PNG (1×1 transparent pixel) written to disk for upload tests
  const tmpFile = path.join(os.tmpdir(), `ringmark-test-${Date.now()}.png`)

  before(() => {
    // 67-byte minimal PNG
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890' +
      '000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex'
    )
    writeFileSync(tmpFile, png)
  })

  after(() => {
    try { unlinkSync(tmpFile) } catch { /* already gone */ }
  })

  it('sends multipart POST to /objects/:id/photos and returns photo ID', async () => {
    let capturedUrl = ''
    let capturedAuth = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedAuth = (init?.headers as Record<string, string>)?.['Authorization'] ?? ''
      return Response.json({
        id: 'photo-uuid-123',
        object_id: 'obj-uuid-456',
        storage_path: 'acc/obj/photo.png',
        caption: null,
        is_public: true,
        sort_order: 0,
        signed_url: 'https://storage.example.com/test.png',
        created_at: '2026-01-01T00:00:00.000Z',
      }, { status: 201 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH1', file_path: tmpFile },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(
        capturedUrl.includes('/objects/RH1/photos'),
        `expected URL to include /objects/RH1/photos, got: ${capturedUrl}`
      )
      assert.equal(capturedAuth, `Bearer ${TEST_KEY}`)
      assert.ok(textOf(result).includes('photo-uuid-123'), `expected photo ID in response, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('includes caption in the form when provided', async () => {
    let capturedForm: FormData | null = null
    const original = global.fetch
    global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedForm = init?.body as FormData
      return Response.json({
        id: 'photo-uuid-456',
        object_id: 'obj',
        storage_path: 'acc/obj/p.png',
        caption: 'My caption',
        is_public: true,
        sort_order: 1,
        signed_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }, { status: 201 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH1', file_path: tmpFile, caption: 'My caption' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedForm !== null, 'fetch body should be FormData')
      const form = capturedForm as FormData
      assert.equal(form.get('caption'), 'My caption', 'caption should appear in FormData')
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('image_url fetches the URL and sends bytes to the API', async () => {
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890' +
      '000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex'
    )

    let fetchCallCount = 0
    let capturedApiUrl = ''
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, _init?: RequestInit) => {
      fetchCallCount++
      const urlStr = String(url)
      if (urlStr.includes('example.com')) {
        // First call: the image URL fetch
        return new Response(pngBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }
      // Second call: the API upload
      capturedApiUrl = urlStr
      return Response.json({
        id: 'photo-url-aaa',
        object_id: 'obj',
        storage_path: 'acc/obj/p.png',
        caption: null,
        is_public: true,
        sort_order: 0,
        signed_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }, { status: 201 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH5', image_url: 'https://example.com/bowl.png' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.equal(fetchCallCount, 2, 'expected two fetch calls: URL + API')
      assert.ok(capturedApiUrl.includes('/objects/RH5/photos'), `wrong API URL: ${capturedApiUrl}`)
      assert.ok(textOf(result).includes('photo-url-aaa'), `expected photo ID, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('image_url with a non-200 response surfaces the status', async () => {
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL) => {
      if (String(url).includes('example.com')) {
        return new Response('Forbidden', { status: 403 })
      }
      return Response.json({})
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH5', image_url: 'https://example.com/private.jpg' },
      })
      assert.ok(result.isError, 'expected isError: true for a 403 image URL')
      assert.ok(textOf(result).includes('403'), `expected 403 in error, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('image_data + filename uploads base64 bytes without reading the disk', async () => {
    // Minimal 1×1 PNG as base64 — same bytes as the tmpFile but passed inline
    const pngBase64 = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890' +
      '000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex'
    ).toString('base64')

    let capturedUrl = ''
    let capturedBody: FormData | null = null
    const original = global.fetch
    global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = init?.body as FormData
      return Response.json({
        id: 'photo-b64-789',
        object_id: 'obj',
        storage_path: 'acc/obj/p.png',
        caption: null,
        is_public: true,
        sort_order: 0,
        signed_url: null,
        created_at: '2026-01-01T00:00:00.000Z',
      }, { status: 201 })
    }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH4', image_data: pngBase64, filename: 'chat-photo.png' },
      })
      assert.ok(!result.isError, `unexpected error: ${textOf(result)}`)
      assert.ok(capturedUrl.includes('/objects/RH4/photos'), `wrong URL: ${capturedUrl}`)
      assert.ok(capturedBody !== null, 'fetch should have been called')
      assert.ok(textOf(result).includes('photo-b64-789'), `expected photo ID, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('image_data without filename returns an error without calling the API', async () => {
    let fetchCalled = false
    const original = global.fetch
    global.fetch = async () => { fetchCalled = true; return Response.json({}) }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH4', image_data: 'dGVzdA==' }, // no filename
      })
      assert.ok(result.isError, 'expected isError: true when filename is missing')
      assert.ok(!fetchCalled, 'fetch should not be called when required field is absent')
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('neither file_path nor image_data returns a descriptive error', async () => {
    let fetchCalled = false
    const original = global.fetch
    global.fetch = async () => { fetchCalled = true; return Response.json({}) }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH4' }, // nothing to upload
      })
      assert.ok(result.isError, 'expected isError: true when no source is provided')
      assert.ok(!fetchCalled, 'fetch should not be called')
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('nonexistent file returns a "File not found" error without calling the API', async () => {
    let fetchCalled = false
    const original = global.fetch
    global.fetch = async () => { fetchCalled = true; return Response.json({}) }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH1', file_path: '/nonexistent/path/photo.jpg' },
      })
      assert.ok(result.isError, 'expected isError: true for a missing file')
      assert.ok(!fetchCalled, 'fetch should not be called when file cannot be read')
      assert.ok(textOf(result).includes('File not found'), `expected file-not-found error, got: ${textOf(result)}`)
    } finally {
      global.fetch = original
      await cleanup()
    }
  })

  it('permission-denied file surfaces a TCC/permissions error without calling the API', async () => {
    const lockedFile = path.join(os.tmpdir(), `ringmark-test-locked-${Date.now()}.png`)
    writeFileSync(lockedFile, 'locked')
    chmodSync(lockedFile, 0o000)

    let fetchCalled = false
    const original = global.fetch
    global.fetch = async () => { fetchCalled = true; return Response.json({}) }
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH1', file_path: lockedFile },
      })
      assert.ok(result.isError, 'expected isError: true for a permission-denied file')
      assert.ok(!fetchCalled, 'fetch should not be called when file cannot be read')
      assert.ok(
        textOf(result).includes('Permission denied'),
        `expected permission-denied error, got: ${textOf(result)}`
      )
    } finally {
      chmodSync(lockedFile, 0o644)
      try { unlinkSync(lockedFile) } catch { /* already gone */ }
      global.fetch = original
      await cleanup()
    }
  })

  it('API error on upload surfaces the error message', async () => {
    const restore = mockFetch(
      Response.json({ error: 'Storage upload failed: bucket quota exceeded' }, { status: 500 })
    )
    const { client, cleanup } = await connectPair()
    try {
      const result = await client.callTool({
        name: 'upload_photo',
        arguments: { object_id: 'RH1', file_path: tmpFile },
      })
      assert.ok(result.isError, 'expected isError: true for a 500 response')
      assert.ok(
        textOf(result).includes('Storage upload failed'),
        `expected storage error message, got: ${textOf(result)}`
      )
    } finally {
      restore()
      await cleanup()
    }
  })
})
