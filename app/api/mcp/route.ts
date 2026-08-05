/**
 * Remote MCP endpoint for Ringmark.
 *
 * Implements MCP JSON-RPC 2.0 over HTTP (Streamable HTTP transport, stateless
 * mode) using the existing in-process server factory. Compatible with
 * claude.ai Remote MCP and any standard MCP client.
 *
 * Authentication: Authorization: Bearer <account API key>
 *   Generate a key at Settings → API Keys. The same key authenticates both
 *   this endpoint and the underlying REST API calls it makes.
 *
 * Tool surface: same tools as the local stdio server, with one difference —
 *   createServer() is built without allowForceDelete, so delete_object has no
 *   `force` parameter here. Combined with the API's existing guards, the only
 *   object this endpoint can delete is an unpublished leaf. delete_photo is a
 *   soft delete and is reversible via restore_photo.
 *
 * Migration from MCP_SECRET:
 *   The previous MCP_SECRET env var is no longer used. Generate a new API key
 *   from Settings → API Keys and update your claude.ai integration to use it.
 *   MCP_SECRET can be removed from your environment.
 *
 * To add in claude.ai → Settings → Integrations → Add MCP server:
 *   URL:  https://ringmark.org/api/mcp
 *   Auth: Bearer <your account API key from Settings → API Keys>
 *
 * For local Claude Desktop (mcp/index.ts stdio entry point):
 *   Update RINGMARK_API_KEY in .env.local to your account API key.
 */

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createServer } from '@/mcp/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authenticateApiRequest } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

const SERVER_INFO = { name: 'ringmark', version: '0.4.0' } as const

function jsonRpcOk(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id, result })
}

function jsonRpcErr(id: unknown, code: number, message: string, status = 200): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}

async function withClient<T>(apiKey: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const apiBase =
    (process.env.RINGMARK_API_URL ?? 'https://ringmark.org').replace(/\/$/, '') + '/api/v1'

  // 55s timeout — stays under Vercel's 60s function limit
  const mcpServer = createServer(apiKey, apiBase, 55_000, { hosted: true })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'ringmark-http-proxy', version: '1.0.0' })

  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

// ── POST — all MCP messages ───────────────────────────────────────────────────

export async function POST(request: Request) {
  // Validate the Bearer token against api_keys (dual-mode: DB hash first,
  // RINGMARK_API_KEY env var fallback while that transition is still active)
  const authHeader = request.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonRpcErr(null, -32001, 'Unauthorized', 401)
  }
  const apiKey = authHeader.slice('Bearer '.length)
  if (!apiKey) {
    return jsonRpcErr(null, -32001, 'Unauthorized', 401)
  }

  const db = createServiceClient()
  const { error: authErr } = await authenticateApiRequest(request, db)
  if (authErr) {
    return jsonRpcErr(null, -32001, 'Unauthorized', 401)
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonRpcErr(null, -32700, 'Parse error', 400)
  }

  const { id = null, method, params } = body

  try {
    switch (method) {
      // ── Lifecycle ───────────────────────────────────────────────────────────
      case 'initialize':
        return jsonRpcOk(id, {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })

      case 'notifications/initialized':
        // Client acknowledges init — no response body required
        return new Response(null, { status: 202 })

      case 'ping':
        return jsonRpcOk(id, {})

      // ── Tool discovery ──────────────────────────────────────────────────────
      case 'tools/list': {
        const result = await withClient(apiKey, c => c.listTools())
        return jsonRpcOk(id, result)
      }

      // ── Tool execution ──────────────────────────────────────────────────────
      case 'tools/call': {
        const p = params as { name: string; arguments?: Record<string, unknown> }
        const result = await withClient(apiKey, c =>
          c.callTool({ name: p.name, arguments: p.arguments ?? {} })
        )
        return jsonRpcOk(id, result)
      }

      default:
        return jsonRpcErr(id, -32601, `Method not found: ${method}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonRpcErr(id, -32603, message)
  }
}

// ── GET — health check / method hint ─────────────────────────────────────────

export async function GET() {
  return Response.json({
    service: 'Ringmark MCP',
    version: SERVER_INFO.version,
    protocol: LATEST_PROTOCOL_VERSION,
    usage: 'POST with Authorization: Bearer <account API key> and a JSON-RPC 2.0 body',
    keysUrl: '/settings',
  })
}
