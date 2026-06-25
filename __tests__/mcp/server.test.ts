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
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../../mcp/server.js'

const TEST_KEY = 'test-api-key'
const TEST_BASE = 'http://test.local/api/v1'

const EXPECTED_TOOLS = [
  'add_child',
  'create_object',
  'delete_photo',
  'get_lineage',
  'get_object',
  'list_objects',
  'list_photos',
  'publish_object',
  'save_story',
  'search_objects',
  'update_object',
  'upload_photo',
].sort()

// ── Helpers ───────────────────────────────────────────────────────────────────

type Pair = { client: Client; cleanup: () => Promise<void> }

async function connectPair(timeoutMs = 30_000): Promise<Pair> {
  const server = createServer(TEST_KEY, TEST_BASE, timeoutMs)
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
  it('tools/list returns all 12 expected tools', async () => {
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
