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
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../../mcp/server.js'

const TEST_KEY = 'test-api-key'
const TEST_BASE = 'http://test.local/api/v1'

const EXPECTED_TOOLS = [
  'add_child',
  'create_object',
  'get_object',
  'list_objects',
  'publish_object',
  'save_story',
  'search_objects',
  'update_object',
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
  it('tools/list returns all 8 expected tools', async () => {
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
